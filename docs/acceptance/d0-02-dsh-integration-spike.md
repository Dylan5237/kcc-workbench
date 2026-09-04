# D0-02 — DSH Windows Workspace Integration Spike：验收报告

- WorkPackage：D0-02（GitHub Issue `#5`）
- Exact baseline：`014ab506dcfb6f9efe2154278cec4916cfc2f743`
- Exact HEAD：`feat/d0-02-dsh-integration` 分支 tip（本报告随实现提交一并入库，见 git log）
- Dedicated worktree：`D:\_projects\tools\kcc-workbench-wt-d0-02`（绝对路径）
- Branch：`feat/d0-02-dsh-integration`
- 执行 Harness：KimiCode（Backend / Integration Engineer 角色）
- 验证日期：2026-09-04，Windows 11，.NET SDK 7.0.102，WebView2 Runtime 152.0.4191.53

## 结论

**DSH 现有能力足以提供全部 Windows 集成缝，无需 DSH Plugin / Creator Mode。不触发 `PLUGIN_REQUIRED`。**

最短可靠路径 = **attach 优先 + 自有启动兜底**：

1. 用 DSH 专有 RPC 形状探测默认 authority（`127.0.0.1:3080`）上是否已有 DSH；
2. 有 → attach（复用用户实例与其全部会话状态）；
3. 没有 → `dsh web --port 0 --no-open` 启动 Arckeep 自有实例，stdout 解析实际端口，`host.describe` 轮询判定 ready；
4. WebView2 导航到 `http://127.0.0.1:<port>/`，hide/show 与工作面切换用 `Visible` 切换（ShellWindow 同款模式），不 reload；
5. 退出时只 taskkill 自有进程树；attached 实例绝不动。

## DSH 版本 / build 证据

- `dsh --version` → `0.1.1-rc.2`（全局 npm 包 `@deepseek-ai/dsh@0.1.1-rc.2`，`C:\nvm4w\nodejs\dsh`）
- profile：`~/.dsh/profiles/web/`（cordis 组合 profile，bundles 含 `@deepseek-ai/dsh-base` / `dsh-web-app` / subagent-claude-code / subagent-codex）
- `POST /api/host.describe` 应答含 `version:"0.0.1"`（web app 版本）、`cwd`、`home`、`provider`、`model`、`attachedSessions`
- `dsh web --dump-config`：`dsh-host-webserver` 默认 `host=127.0.0.1`、`port=3080`

## D1 — start / attach seam

- 启动命令：`dsh web [--host 127.0.0.1] [--port <n|0>] [--no-open]`（`dsh web --help` 实测）
- 进程路径：`cmd.exe /c dsh web …` → `node.exe …/@deepseek-ai/dsh/lib/bin.js web …`
- **attach 识别信号**：`POST /api/host.describe`，body `{"type":"client-request","rpcId":…,"method":"host.describe","payload":{}}` → `server-response` 且 `result.ok=true` 且 value 带 `cwd`/`home`。该形状是 DSH 专有，不会误认占用 3080 的其他服务。
- **loopback 免配置**：DSH 的 `/api` browser-trust fence（`dsh-client-connection`）对 loopback Host 放行；WebView2 导航 `http://127.0.0.1:<port>` 的 Origin 与 Host 同源，`/api` POST 全部通过，无需 `--trusted-host`。
- 决策：**attach 优先**。用户已有实例携带其真实 workspace/session 状态，重复启动无意义。

## D2 — Readiness

- 确定性信号：`POST /api/host.describe` 返回 `result.ok=true`（400ms 轮询，无固定 sleep）。
- 辅助信号：stdout 行 `dsh web: http://127.0.0.1:<port>`（`--port 0` 时给出 OS 分配端口，实测 `6201`）。
- 冷启动实测：owned 模式从 `Process.Start` 到 ready 约 5.5–15.6s（三次运行 5481/7261/8782ms + 首次 15614ms）。

## D3 — 真实 Web 表面进 WebView2

- 探针 `spike/dsh-webview2/`（独立 UDF）导航真实 DSH URL：`NavigationCompleted IsSuccess=true`，`document.title == "DeepSeek Harness"`。
- 无任何替代 UI；页面即用户浏览器里看到的同一个 DSH workspace。
- 证据：`spike/results/dsh-probe-owned.json`（`d3_nav_completed=true`）、`dsh-probe-attach.json`。

## D4 — Persistence（hide/show 与工作面切换）

- 方法：页面内注入 `window.__arckeepProbeMark` + 记录 `performance.timeOrigin`；`Visible=false` 3s → 恢复；再切到对端 WebView2 3s → 切回；两次校验标记与 timeOrigin。
- 结果（owned/attach 两模式均通过）：
  - `d4_mark_survives_hide_show=true`，`d4_timeorigin_equal_after_hide_show=true`
  - `d4_mark_survives_switch=true`，`d4_timeorigin_equal_after_switch=true`
- timeOrigin 不变 = 页面未 reload，session 存活。与 ShellWindow 既有 `_agentView.Visible` 切换模式一致。

## D5 — Failure isolation

- **启动失败**（`DSH_PROBE_MODE=fail`，PATH 中无 dsh）：`StartAsync` 返回 `null` 且不抛出，`Failure` 记录原因，壳渲染受控故障页（「DSH 工作面不可用 / 其他工作面不受影响」），壳与其他 WebView2 正常工作。证据：`dsh-probe-fail.json`（`fail_start_returned_null=true`、`shell_alive_in_failure=true`）。
- **运行中故障**（`DSH_PROBE_KILL=1`，验证通过后 taskkill 自有 DSH）：`d5_dsh_unreachable_after_kill=true`、`d5_shell_alive_after_dsh_kill=true`、`d5_controlled_state_after_kill=true`。证据：`dsh-probe-owned-kill.json`。
- **真实世界印证**：本机 3080 上有一个 9/3 挂载起的用户旧实例，间歇性「接受 TCP 但不应答」。attach 探针 3s 超时后正确落到 owned 启动，未被拖死——超时上限是该路径的必要设计。

## D6 — Process ownership / shutdown semantics

- `DshService.Ownership`：`Attached`（用户既有实例）/ `Owned`（Arckeep 创建）。
- `Dispose()`：仅 `Owned` 时 `taskkill /PID <pid> /T /F` 并等待退出（进程树整体终止）；`Attached` 不做任何进程操作。
- 实测：
  - owned：`owned_process_gone_after_exit=true`（`dsh-probe-owned.json`）
  - attach：`attached_alive_after_exit=true`（`dsh-probe-attach.json`），模拟用户实例在探针退出后仍正常服务。
- 防误杀设计：attach 只认 `host.describe` 验明正身的实例；owned 启动用 `--port 0`，绝不与用户实例争端口，也不 bind 用户可能在用的 3080。

## Changed files

- `arckeep/shell/DshService.cs`（新增）— 生产 glue：start/attach/readiness/ownership
- `spike/dsh-webview2/DshSpike.csproj`、`spike/dsh-webview2/Program.cs`（新增）— WebView2 集成探针（链接生产 `DshService.cs` 源码，验证的就是真接缝）
- `spike/results/dsh-probe-owned.json` / `dsh-probe-owned-kill.json` / `dsh-probe-attach.json` / `dsh-probe-fail.json`（新增，证据）
- `.gitignore`（spike/dsh-webview2 构建与 UDF 产物）

未改动：`ShellWindow.cs` 及任何既有行为（工作面接线属 D0-03）；未触碰 DSH 本体、Kimi/Claude、Viewer。

## Build / tests

- `arckeep/shell`：`dotnet build -c Release` 0 错误（仅既有 MSB3277 WPF 引用警告，spike README 已记录无害）
- `spike/dsh-webview2`：`dotnet build -c Release` 0 错误
- 探针四场景全部通过（owned / owned+kill / attach / fail），结果 JSON 入库
- `npm test` 未运行：本 diff 不含任何 JS/TS 改动（`src/`、`test/` 均未触碰），KCC v1 Node 测试与本改动无覆盖关系；worktree 未执行 `npm ci`

## Limitations

1. **attach 发现面窄**：只探测组合默认 authority（3080）。用户用 `--port 0` 启动的实例（本机实测 8188/1288 两个）无法被 Arckeep 发现——此时 Arckeep 会起一个自有实例与之并存（行为正确但非最优）。后续如需全量发现，可按进程命令行扫描 node/dsh，属增强而非必需。
2. **挂起实例语义**：3080 旧实例「接受连接不应答」时 attach 判负并自有启动；若该实例稍后恢复，会出现两个 DSH。产品层可后续加「attach 成功但中途失联」的提示，D0 不阻塞。
3. **失败诊断乱码**：cmd shim 的 GBK 错误文本按 UTF-8 解码在 `Failure` 消息里呈乱码（仅诊断文本，功能判定不受影响）。
4. **D5 的 Kimi/Claude/Viewer 共存**：在探针壳（双 WebView2）级别证明；与 Arckeep `ShellWindow` 内既有工作面的真实共存属 D0-03 接线后验证。
5. **截图证据**：按 Taskbook §8，编码 Harness 不提供截图；如需视觉证据由用户在真机补充。
6. `dsh web` 无独立版本 RPC；`host.describe` 的 `version` 是 web app 版本（0.0.1），CLI 版本以 `dsh --version` 为准。

## STOP 状态

无 `PLUGIN_REQUIRED`、无 `ARCHITECTURE_EXCEPTION`。等待 ChatGPT Architecture Review；不 merge，不启动 D0-03。
