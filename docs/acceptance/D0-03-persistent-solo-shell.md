# D0-03 — Persistent Solo Shell：验收证据报告

- WorkPackage：D0-03（GitHub Issue `#6`）
- Role：Global / Runtime Engineer（KimiCode）
- Exact baseline：`b2a76722cf7c3e5db994acadf9d210edfaf42ffd`
- Exact HEAD：见 git log（本报告随实现提交一并入库）
- Branch：`feat/d0-03-persistent-solo-shell` → PR target `integration/arckeep-daily-driver`
- Dedicated worktree：`D:\_projects\tools\kcc-workbench-wt-d0-03`
- 验证日期：2026-09-05，Windows 11，.NET SDK 7.0.102，WebView2 Runtime，Node 22
- 驱动探针：`spike/shell-switch/probe-d0-03.mjs`（真实启动 Arckeep.exe，进程外核对 PID 存亡）

## 0. 结论

四个工作面（Kimi / Claude(cdesktop) / DSH / Viewer）+ Project 已接入同一真实 Windows ShellWindow，
普通切换为纯可见性切换（V2/V4 标记 + timeOrigin 证据），真实 Claude session 跨切换续跑（V3），
Claude/DSH 受控失败不拖垮其余工作面（V7），Owned/Attached 关机语义在真实壳退出路径上验证（V8）。
无 STOP gate 触发。

## 1. 工作面切换架构

```
ShellWindow（WinForms + 原生标题栏）
├─ Project  —— _uiView（arckeep.local 虚拟宿主，既有 Project UI / rail 双模式）
├─ Kimi     —— _agentView（左工作面 + 右 320px 项目侧轨，接入态布局）→ KimiWebService（+ ACP）
├─ Claude   —— _claudeView（整幅覆盖层）→ CdesktopService（新增）
├─ DSH      —— _dshView（整幅覆盖层）→ DshService（D0-02 原样接线）
└─ Viewer   —— _viewerView（整幅覆盖层）→ ViewerService（D0-04 原样接线）
```

- 标题栏一级按钮：Project / Kimi / Claude / DSH / Viewer（粗体高亮当前工作面）+ 当前项目名 + 既有额度 chip。
- 每个工作面独立持久 WebView2（独立 UDF），惰性初始化；`*LoadedUrl` 记录已导航地址，
  普通切回只做 `Visible`/`BringToFront`，绝不重新 Navigate/重建/停 session。
- 「打开 Kimi 工作面」（标题栏 Kimi 按钮，只起 Kimi Web）与「经 ACP 交付 Brief」
  （项目空间「开始」，Brief → session/prompt → follow-up → 回流）解耦，共享同一持久 `_agentView`；
  Brief 路径不再 reload 已打开的 Kimi 页面。
- 未做 generalized AgentAdapter / Runtime Registry / plugin 架构；只有一个 `Workspace` 枚举 + 显式 Open 方法。

## 2. CdesktopService 生命周期（新增 `arckeep/shell/CdesktopService.cs`）

- **Attach 优先**：读 `%TEMP%\cdesktop\cdesktop.port`（JSON `main_port` 或裸数字）→
  `GET /api/health` 且 `success=true` 验明正身 → 复用用户实例。端口文件陈旧（health 失败）自然落到 owned。
- **Owned 启动**：二进制解析 `CDESKTOP_BIN` 覆盖 → 精确 tag `v0.2.3-20260519022845` →
  `~/.cdesktop/bin/` 任意已下载版本；`PORT=0 HOST=127.0.0.1` 环境变量注入（OS 分配，不争端口）。
- **确定性 readiness**：stdout `Main server on :NNNN` 为主、本次启动后新写入的端口文件为辅，
  再轮询 `/api/health`；无固定 sleep。
- **Ownership**：`Process.Start` 成功即刻 `Mode=Owned`（机械归属）；任何 post-spawn 失败
  （含 readiness 超时）先 `TerminateOwned()`（`taskkill /PID /T /F` + 等退出 + 状态复位）再返回 null；
  `Dispose()` 仅 Owned 时终止；Attached 模式 `_proc` 恒为 null，用户实例绝不受影响。
- **Project continuity**：每次进入都对当前 Arckeep 项目根做幂等 workspace 确保
  （`/api/repos` 按路径复用或注册 → `/api/workspaces` 按 `arckeep-<name>-<hash8>` 命名约定复用，
  否则 `use_worktree:false` 创建并挂载 repo）。不引入 cdesktop Team/Worktree 域。
  workspace 确保失败只记 `WorkspaceError`，不拖垮服务本身。

## 3. Service ownership 矩阵（实测）

| 场景 | Kimi | Claude/cdesktop | DSH | Viewer |
| --- | --- | --- | --- | --- |
| shell-switch | 复用既有实例（ownedPid=null） | **Owned** pid 114996 → 退出后消失 | **Owned** pid 134868 → 退出后消失 | Owned pid 136236 → 消失 |
| attach | 复用 | **Attached** 127.0.0.1:11853 → 退出后存活 | **Attached** 127.0.0.1:3080 → 退出后存活 | Owned → 消失 |
| fail-claude | 复用存活 | **None（真实失败）** | Owned/Attached 存活 | Owned → 消失 |
| fail-dsh | 复用存活 | Owned pid 100384 → 消失 | **None（真实失败）** | Owned → 消失 |

## 4. 验证矩阵（真实 Windows 运行，非 mock）

| # | 项 | 结果 | 证据 |
| --- | --- | --- | --- |
| V1 | 冷启动主窗口不等待外部服务 | ✅ shown 后 3.49s 项目 UI alive；此刻 kimi/claude/dsh/viewer 全部未启动 | `spike/results/d0-03-shell-switch.json` → `proof.v1` |
| V2 | 全序列切换无 reload | ✅ `Project→Kimi→Claude→DSH→Viewer→Claude→Kimi→DSH→Project`；三面 `__arckeepMark` 与 `performance.timeOrigin` 回访逐值相等 | 同上 → `first`/`second`/`persistence` |
| V3 | 真实 Claude session 跨切换续跑 | ✅ owned 运行：session `0681462f…` 首轮 completed → 切走切回 → 同 session 续跑 completed；attach 运行复验：session `e5420b59…` 同样 completed→completed（executor=CLAUDE_CODE，真实 claude CLI） | 同上 → `v3_first`/`v3_resume`；`d0-03-attach.json` |
| V4 | DSH 切走切回页面/session 保持 | ✅ mark `007c44c8` + t0 相等（owned）；attach 运行同样相等 | 同上 → `persistence.dshNoReload` |
| V5 | Kimi Web + ACP Brief/follow-up smoke | ✅ `ARCKEEP_AUTO=1` exit 0；真实 ACP session `session_b87b4d95…`，stopReason `end_turn`，记录落 `.arckeep/sessions.json` | 会话记录 + `spike/results/d0-03-kimi-auto.png` |
| V6 | Viewer 回归 | ✅ WebView2 钩子 exit 0（真实项目树加载，treeChildren≥1）；`npm test` 124/124（含 viewer-standalone 2 用例） | `d0-03-viewer-proof.json` |
| V7 | 故障隔离 | ✅ Claude 真实失败（bogus `CDESKTOP_BIN`+端口文件）：DSH/Kimi/Viewer/Project 全部可用；DSH 真实失败（PATH 前置假 `dsh.cmd` + 空 attach 端口）：Claude(owned 7137)/Kimi/Viewer/Project 全部可用 | `d0-03-fail-claude.json`、`d0-03-fail-dsh.json` |
| V8 | 关机 ownership | ✅ 全部走真实 `Form.Close()` → `FormClosed` 路径：Owned cdesktop/DSH/Viewer 进程退出后 tasklist 核对消失；Attached 用户 cdesktop(11853)/DSH(3080) 退出后 health/describe 仍活 | 各结果 JSON 的 `shutdown` 段 |

## 5. Build / tests

- `arckeep/shell`：`dotnet build -c Release` **0 错误**（仅既有 MSB3277 WPF 引用警告）。
- 仓库根：`npm ci` 后 `npm test` **124/124 通过**。
- 探针四场景全部 exit 0：`switch` / `attach` / `fail-claude` / `fail-dsh`，结果 JSON 入库 `spike/results/`。

## 6. Changed files

新增：
- `arckeep/shell/CdesktopService.cs` — cdesktop attach/owned 生命周期 + workspace 确保
- `arckeep/shell/ShellWindow.TestHooks.cs` — D0-03 真实验证钩子（partial class，正常启动零开销）
- `spike/shell-switch/probe-d0-03.mjs` — 进程外驱动 + 关机 PID 核对探针
- `spike/results/d0-03-shell-switch.json` / `d0-03-attach.json` / `d0-03-fail-claude.json` / `d0-03-fail-dsh.json` / `d0-03-viewer-proof.json` / `d0-03-kimi-auto.png` — 证据
- `docs/acceptance/D0-03-persistent-solo-shell.md` — 本报告

修改：
- `arckeep/shell/ShellWindow.cs` — 五工作面切换（标题栏按钮、`SwitchToAsync`、覆盖层布局）、
  Kimi 打开/Brief 解耦、当前项目标签、`SetProject` 提取、Viewer 段迁入统一切换、D0-04 viewer 钩子适配
- `arckeep/shell/KimiWebService.cs` — 仅 +`OwnedPid` 诊断属性（3 行）
- `arckeep/README.md` — 结构/切换模型/钩子/已知边界
- `AGENTS.md` — 运行时前置补充 cdesktop/DSH（均为可选，缺席不阻塞壳）

未改动：`DshService.cs`（D0-02 原样接线）、`ViewerService.cs`、`src/viewer/**`、`arckeep/ui/**`（视觉冻结期不动）、KCC v1 `src/**`。

## 7. Limitations（诚实读法）

1. **cdesktop 冷启动弹外部浏览器**：0.2.3 无已验证 no-open 开关（npm wrapper 与二进制均无），
   按 Taskbook 登记为 D0 limitation，未 fork/patch。Owned 启动每次会弹一个浏览器窗口。
2. **cdesktop attach 发现面 = 端口文件单例**：用户多开 cdesktop 时只能发现最后写端口文件的实例。
3. **DSH attach 探测点窄**（沿用 D0-02 已登记限制）：只探 3080。本机 9/3 遗留的挂起旧实例
   「接受 TCP 不应答」时 attach 判负、3s 超时落 owned——该行为在 fail-claude 首轮复现（Owned），
   实例恢复后 attach 场景复现为 Attached，两条路径均有真实证据。
4. **Kimi 复用既有实例时 ownedPid=null**：端口持久化复用路径下 Arckeep 不拥有该进程，
   退出不杀（与 v1 语义一致）；owned 路径的 taskkill 兜底未改动。
5. **Claude/DSH/Viewer 为整幅覆盖层**：覆盖 Kimi 接入态的侧轨只是可见性遮挡，不做并排混排；
   视觉/IA 收敛属 D0-05（真实截图驱动）。
6. **测试钩子成本**：switch/attach 场景各创建一次真实 Claude session（两条短 prompt，真实计费）。
7. 截图证据：按 Taskbook §8，编码 Harness 不自判视觉；`d0-03-kimi-auto.png` 为 AUTO 路径自动抓图，
   更多截图由用户真机补充。

## 8. STOP 状态

无 `CDESKTOP_INTEGRATION_BLOCKED` / `DSH_INTEGRATION_BLOCKED` / `KIMI_REGRESSION` / `ARCHITECTURE_EXCEPTION`。
不 merge，不启动 D0-05 / D0-V。等待 ChatGPT Architecture Review。
