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

---

# R1 — S3 Project Continuity 修复（Architecture Review REQUEST_CHANGES 后）

Reviewed HEAD：`1890aa706dd8d6d61402559c693f9d759aea733e`
Finding：workspace switching 与 project switching 混淆；A→B 后 Kimi/Claude/DSH 仍停在 A
（`_*LoadedUrl` 非空短路）。修复 = 最小 project binding，无 generalized abstraction。

## R1.1 绑定模型

显式区分两类切换：

- **普通工作面切换**（Kimi→Claude→DSH→Viewer→…）：`Open*` 守卫
  `_*LoadedUrl != null && SamePath(_*BoundRoot, currentRoot)` → 直接 return，纯可见性，不 reload。
- **显式项目切换**（`SetProject` 检测 root 变化）→ `RebindSurfaces(B)`：
  只重绑**已加载**的工作面（未打开的下次 Open 自然按 B 绑定）：

| 工作面 | 绑定机制 | A→B 行为 |
| --- | --- | --- |
| Kimi | `_kimiBoundRoot` + `_kimiBoundSessionId`；`KimiWebService.BindSessionAsync`：`GET /api/v1/sessions` 找 `metadata.cwd==B` 的最近 session，否则 `POST /api/v1/sessions {metadata:{cwd}}` 创建空 session（实测 200、message_count=0、不启动 turn、不计费），导航 `/sessions/<id>` | 同实例换 session（intentional navigate），不重启 kimi web，绝不 kill 用户实例 |
| Claude | `_claudeBoundRoot`；cdesktop 进程复用，对 B 再 `EnsureWorkspace` → `WorkspaceId=B`，导航 `/workspaces/{idB}`（0.2.3 既有 SPA 路由） | intentional navigate，不杀 cdesktop |
| DSH | `DshService.BoundCwd`（Owned=启动 cwd；Attached=host.describe 真实 cwd） | Owned 且 cwd 过期 → Dispose 自有实例 + 按 B cwd 重启；Attached 用户实例绝不 kill，诚实记录其实例 cwd |
| Viewer | 既有 `SyncViewerRoot`（D0-04 seam） | 不变 |

## R1-4 cdesktop target_branch

实测 cdesktop 0.2.3：`target_branch` 为**必填**（缺失 → 422）；
`default_target_branch` 由上游探测（无 remote 的 git 仓库也可能为 null）。
取值顺序：`repo.default_target_branch` → 项目当前 git 分支（`git rev-parse --abbrev-ref HEAD`，只读事实）
→ 非 git 回退 `main`（`is_git=false` 时该值不被使用，既有证据）。
验证：项目 B 为 git 仓库且当前分支 `feature-x`（非 main），workspace 挂载成功、`WorkspaceError=null`、
`LastTargetBranch="feature-x"`（`d0-03-rebind*.json` → `asserts.claudeTargetBranch`）。

## R1 双项目证据（真实运行，两 fixture 目录各带 `.arckeep-test-project-a/b` 标记）

`spike/results/d0-03-rebind.json`（DSH 自然 attach 路径）：

- Phase A：Kimi session `session_b1933d4f…`（cwd=A）；Claude workspace `4ca7d0a7…`，
  href `…/workspaces/4ca7d0a7…`；Viewer root=A；DSH Attached（用户 3080 实例，cwd 如实记录）。
- `SetProject(B)` 后：Kimi → 新 session `session_3df9632a…`（cwd=B，标题变为
  `d0-03-proj-hdwhKl | Kimi Code`——不再是旧项目）；Claude `WorkspaceId` → `8c0c3158…`，
  href `…/workspaces/8c0c3158…`，`target_branch=feature-x`；Viewer root=B；全部断言 `true`。
- B 内真实 Claude session `23866d49…` completed（B workspace 功能验证）。
- B 内普通切换 Kimi→Claude→DSH→Viewer→Claude→Kimi：mark/timeOrigin 逐值相等，
  `ordinarySwitchNoReloadInB=true`。

`spike/results/d0-03-rebind-owned-dsh.json`（强制 owned DSH 路径）：

- A：Owned DSH cwd=A；`SetProject(B)` 后：A 的 owned 进程确定死亡（`dshAPidGone=true`）、
  新 owned 实例 cwd=B（`dshBoundCwdIsB=true`、`dshOwnedPidChanged=true`）；
  B 内普通切换仍 no-reload；退出后全部 owned 进程消失。

## R1 回归

- `dotnet build -c Release`：0 错误。
- `npm test`：124/124。
- `switch` 场景重跑（V1/V2/V3/V4/V8 修复后回归）：见 `d0-03-shell-switch.json` 最新一轮。
- Kimi ACP Brief/follow-up（V5）重跑：见报告 §4 V5 行与 `d0-03-kimi-auto-r1.png`。
- V7 故障隔离路径未改动（failure 分支代码同 R0），lifecycle 关机语义未改动；
  重绑新增的 owned-DSH Dispose 由 rebind-owned-dsh 场景的 `dshAPidGone` + 关机矩阵覆盖。

## R1 新增 limitation

- Kimi 绑定依赖 kimi web `metadata.cwd` seam（0.39 实测）；session 列表较大时线性扫描（本机 ~300 条，首次拉取 >10s，超时余量已放宽到 45s）。
- Attached DSH 是用户实例，其内容上下文由用户实例自身决定；Arckeep 只做事实记录，不做项目绑定伪造。
- Kimi 绑定失败时回退到 kimi web base URL 且 `_kimiBoundRoot` 保持空（证据中可判，不冒充绑定）。

---

# R2 — Fail-Closed Project Binding（第二次 REQUEST_CHANGES 后）

Reviewed R1 HEAD：`fd57c4e44cb6e4345fc2197df2d2355de8ac2d2b`
Findings：B1 项目切换非 fail-closed（异步重绑期间旧 A surface 可被当 B 暴露；A→B→C 无 generation 防写回）；
B2 cdesktop 服务健康 ≠ workspace 绑定（旧 A WorkspaceId 可能被解释成 B）；B3 Kimi 绑定失败同样混入；
B4 attached DSH cwd 不匹配时不许冒充当前项目工作面。

## R2.1 Project generation / serialization（BLOCKER 1）

- `_projectGeneration`：每次显式项目切换 +1；`SetProject` 内同步执行。
- 所有异步绑定结果经 `ApplyIfCurrentAsync(generation, root, apply)` 落地：只有
  `generation == _projectGeneration && SamePath(requestedRoot, _store.Root)` 才允许
  导航/写 BoundRoot/session id/loaded URL；否则丢弃并 `_staleApplyCount++`（证据计数）。
- 重绑串行：`RebindSurfaces` 把新重绑链到 `_rebindTask` 上（A→B→C 不并发冲服务）。
- 服务层各自 `SemaphoreSlim` 串行化 StartAsync/BindSessionAsync（Open 与 Rebind 并发安全）。
- `Open*Async`：守卫未命中时先 `await _rebindTask`（项目级重绑优先），再按需自绑。

## R2.2 旧项目 surface 不得冒充新项目（BLOCKER 1 续）

`SetProject(B)` 同步段（UI 线程）：对「已加载且绑定根 ≠ B」的面立即
清 `_*LoadedUrl/_*BoundRoot` 并落「正在绑定到当前项目…」页——此后任何时刻
A 的内容都不会以 B 的名义出现；重绑完成才导航到 B surface。
普通工作面切换在绑定完成后仍然 no-reload（守卫命中即 return）。

## R2.3 Claude 显式绑定结果（BLOCKER 2）

`CdesktopService.Binding`（record：Root/WorkspaceId/WorkspaceUrl/TargetBranch）：
新 root 绑定开始前先清 `Binding=null`（旧 A id 不再可解释为 B）；ensure 成功才产生 Binding；
失败只置 `WorkspaceError`。**服务失败**（Failure/url=null）与**绑定失败**（Binding=null + WorkspaceError）
是两个明确分流的状态，壳层分别渲染「Claude 工作面不可用」与「Claude 项目绑定失败」受控页。

## R2.4 DSH attached cwd 纪律（BLOCKER 3）

`DshService.StartAsync`：attach 仅在 `SamePath(attachedCwd, cwd)` 时成立；
cwd 不匹配的用户实例 → 日志记录 + `Detach()`（纯状态复位，零进程操作）→ `dsh web --port 0` 起 Owned。
不 kill 用户实例；不加 Plugin/Core；不引入 forceOwned 之外的机制（实际连该参数也不需要——规则内建）。

## R2 探针证据（全部真实运行）

| 探针 | 结果 | 关键证据（spike/results/） |
| --- | --- | --- |
| `bindfail`（R2-3） | ✅ exit 0 | `d0-03-bindfail.json`：A 绑定成功（wsA/sessionA）→ SetProject(B) 后删 B 目录 → cdesktop 服务健康 `claudeServiceHealthy=true` 但 `Binding=null`、`WorkspaceError=400 Path does not exist`、`claudeBoundRootIsNotB=true`、href 不再含 wsA（about:blank 受控页）；Kimi 同样 fail-closed 且 `kimiServerAlive=true`（用户实例未被碰）；恢复 B 目录后 Retry：两面均绑定 B（新 ws `d3670404…`/新 session），retry 后普通切换 no-reload |
| `abc`（R2-5） | ✅ exit 0 | `d0-03-abc.json`：A 全绑定 → 8s 人为延迟内 A→B→C → 终态全部 == C（kimi/claude/dsh/viewer），`staleCompletionIgnored=true`（`_staleApplyCount`=3，B 的三面 apply 全被 generation guard 丢弃）；C 内普通切换 no-reload |
| `dsh-mismatch`（R2-6） | ✅ exit 0 | `d0-03-dsh-mismatch.json`：用户 DSH（3080，cwd=agent-team-workbench，≠项目）全程存活且退出后仍活；Arckeep DSH 走 Owned：A 期 cwd=A、B 期 cwd=B（`dshAPidGone=true`）；owned B 退出后消失 |

## R2 回归

- `dotnet build -c Release`：0 错误。`npm test`：124/124。
- 重跑：`rebind`（R1 主场景）、`switch`（V1-V4/V8）、`fail-claude`、`fail-dsh`（V7）、Kimi ACP AUTO smoke（V5）。
- Claude session continuation 代码未改，未重复产生付费证据（R1 证据仍有效）。
- 修复中发现并修复：kimi session 列表 ~300 条时首次拉取 >10s，`BindSessionAsync` 超时放宽到 45s。

## R2 新增 limitation

- 项目切换标记/重绑以「已加载」面为范围；A→B→C 中 B 的绑定副作用（kimi 空 session、cdesktop workspace）
  会发生但被 generation guard 丢弃不展示——空 session/空 workspace 属无害残留（均可复用）。
- fail-closed 的「正在绑定到当前项目…」是 intentional navigation（项目切换允许），非普通切换。
