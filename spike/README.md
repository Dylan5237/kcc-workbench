# Spike：2.0 宿主栈验证（C# 薄壳 + WebView2 + ACP）

> 目的：为 ADR-001 提供实测证据。验证日期 2026-08-28，Kimi Code **0.39.0**，WebView2 Runtime 151.0.4129.107，.NET SDK 7.0.102，Windows 11。
> 本目录是 ADR-001 的证据包，非生产代码。探针可重跑。

## 验证项与结论

| # | 验证项 | 结论 | 证据 |
| --- | --- | --- | --- |
| S-嵌入 | 同窗多 WebView2：agent 原生界面（大）+ 项目侧轨（260px） | ✅ 通过 | `host-webview2/`（WinForms + 双 WebView2 控件）；截图 `results/spike-agent.png` / `spike-rail.png` |
| S-隔离 | 每个 WebView2 独立 UDF（session/cookie 隔离） | ✅ 通过 | agent 视图用全新 UDF 启动后呈现 Kimi 首次引导页（全新 profile 特征）；UDF 目录 `udfs/agent`、`udfs/rail`（运行时生成，不入库） |
| S-登录 | Kimi Web 本地实例（bearer token fragment）在嵌入视图中可用 | ✅ 通过 | 启动 `kimi web --host 127.0.0.1 --port <随机> --no-open`，stdout 解析 openUrl 导航成功（`agent_nav_completed=true`）。注：v1 嵌入的是本地 kimi web（token 鉴权），非 kimi.com 远程登录流 |
| S-1 | 简报注入通道（M1 必验项） | ✅ 通过，且超出预期 | **ACP（Agent Client Protocol）**：`kimi acp` over stdio。initialize → protocolVersion 1（loadSession / list / resume / close / delete / embeddedContext）；`session/new`（带 cwd）→ 返回 `sessionId`；`session/prompt` 携带简报 → 标题即简报文本，流式 `session/update`（agent_thought_chunk / agent_message_chunk），完成回执 `stopReason:"end_turn"`。证据链完整：sessionId + stopReason + transcript 事件流。见 `results/acp-probe.json` |
| S-REST | 补充发现：REST 会话创建 | ✅ 可用 | `POST /api/v1/sessions {metadata:{cwd}}` → `session_id` + `workspace_id`（kimi 0.39 原生 workspace 概念，`wd_*`，与 Arckeep workspace 模型同构）。`{prompt}` 字段被接受但**不自动开 turn**（60s 轮询 message_count=0）；消息发送走 WebSocket `/api/v1/ws?client_id=`（protocol_version 2，服务端事件 union 已识别，客户端消息信封未逆向——不需要了，ACP 是正解） |
| S-性能 | 冷启动 / 内存 / 体积 | ✅ 通过 | 见下表 |

## 性能与体积实测

| 指标 | C# + WebView2（spike） | Electron v1（对照，`--demo-profile=spike-mem`） |
| --- | --- | --- |
| 窗口可见（不含 agent 启动） | **1.07s** | — |
| 含 kimi web 启动到 agent 页渲染完成 | 6.2s（kimi web 启动 2.6s + webview 初始化 + 导航） | — |
| 常驻内存（均嵌入同一 kimi web，静置 12–20s） | **1343 MB**（12 个 webview2 进程）+ 宿主 57 MB | **1698 MB**（12 个 electron 进程，`results/electron-baseline.json`） |
| 分发体积 | **1.7 MB**（框架依赖，需 .NET 运行时）/ 154 MB（自包含单文件，未裁剪） | 436 MB（zip）/ 1.3 GB（unpacked） |

诚实的读法：内存差距（~21%）主要来自不再自背一份 Chromium 运行时；**嵌入的 agent 界面本身在两边都是 Chromium**，所以差距有限，与选型讨论时的预期一致。体积差距是数量级的。

## 已踩坑记录（2.0 开发要避开）

1. WebView2 的 COM 初始化必须在 UI 线程（STA + WinForms 同步上下文）：`CoreWebView2Environment.CreateAsync` 在 MTA 线程池线程上抛 `0x80010106`。全部 webview 逻辑放 `form.Shown` 处理器。
2. `Process.StandardOutput.ReadLineAsync()` 不可并发重入（"stream is currently in use"）；用后台 Pump 任务 + 共享缓冲。
3. WebView2 NuGet 包对 net7.0 有 MSB3277 警告（WPF 引用），用 WinForms 时无害。
4. kimi web 的 openUrl 在 stdout；token 也可读 `~/.kimi-code/server.token`（v1 同款路径，0.39 仍有效）。

## 文件清单

- `probe-kimi-api.mjs` — REST API 探针（meta/sessions/创建会话）→ `results/api-probe.json`
- `probe-kimi-ws.mjs` — WebSocket 探针（server_hello / protocol v2）→ `results/ws-probe.json`
- `probe-kimi-acp.mjs` — ACP 探针（initialize/session-new/session-prompt 全链路）→ `results/acp-probe.json`
- `host-webview2/` — C# 双 WebView2 宿主（可 `dotnet run -c Release` 重跑）→ `results/host-metrics.json` + 两张截图
- `measure-electron-baseline.mjs` — Electron v1 对照测量 → `results/electron-baseline.json`
