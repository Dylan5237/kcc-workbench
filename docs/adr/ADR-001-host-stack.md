# ADR-001：2.0 宿主栈 —— C# 薄壳 + WebView2 + ACP 控制平面

- 状态：**已接受**（2026-08-28，spike 验证通过后落定）
- 决策者：产品负责人（用户）+ 设计/工程（AI）
- 证据包：`spike/`（可重跑）
- 关联：`ARCKEEP_DESIGN_V0.3.md` §9、D-37；评审裁决"宿主栈未拍板，spike 后落 ADR"（v0.3.1 第二轮评审 #10）

## 上下文

2.0 目标：更轻量、性能更好、扩展性更强、纯 AI 开发（vibecoding）。产品契约（项目身份、M1–M5 机制、Viewer、回流）与宿主实现分离，契约已在 v0.3.1 冻结。宿主栈需满足三个硬约束：

1. 同窗嵌入多个第三方 agent 应用（独立 session、布局混排、切换不重载）；
2. 进程内承载本地服务（Viewer HTTP / fs 监控 / Git / agent 进程管理）；
3. AI 编写友好（语料厚度、编译-验证循环成本）。

决策规则（预先约定）：宿主层代码占比预期 <15% 且长期冻结 → C# 薄壳；否则留在 Electron。

## 决策

**2.0 宿主采用：C#（.NET）薄壳 + 系统 WebView2（Evergreen Runtime）+ ACP 作为 agent 控制平面。**

三层职责：

| 层 | 技术 | 职责 |
| --- | --- | --- |
| 壳 | C# / .NET（WinForms 或 WPF，见未决项） | 窗口、生命周期、多 WebView2 布局、进程管理、锁 |
| 视觉平面 | WebView2 × N（各自独立 UDF） | Arckeep UI（HTML/TS，品牌 v1.0）+ agent 原生界面嵌入 |
| 控制平面 | ACP（Agent Client Protocol，stdio/JSON-RPC） | 简报交付、会话生命周期、transcript 证据流（M1/M3 的落地通道） |

ACP 是 spike 的超预期发现：它是为"编辑器/工作台嵌入 agent"设计的版本化协议，kimi 0.39 原生支持（`kimi acp`），天然提供 M1 要求的交付证据（sessionId + stopReason + 流式 transcript）。agent 的原生 Web UI 仍按 D-20 嵌入（接入 ≠ 改造）；ACP 只做控制，不做界面。

## 备选方案与否决理由

| 方案 | 否决理由 |
| --- | --- |
| 留在 Electron（仅重构） | 体积 436MB/1.3GB、内存 1698MB 实测无改善路径；不满足"更轻量"目标 |
| Tauri 2 | 多 webview 经 wry 在 Windows 是独立 HWND 有 airspace/焦点老毛病；后端必须 Rust，与 vibecoding 语料原则冲突 |
| Electrobun | 生态太年轻；Bun ≠ Node，与 agent CLI 生态（npm/Node 22 ABI）不兼容 |
| NW.js | 远程页面 + Node 同上下文是安全反模式 |

## 证据（spike 实测，2026-08-28）

| 验证项 | 结果 |
| --- | --- |
| 同窗双 WebView2 布局（agent + 260px 侧轨） | 通过，无裁剪/焦点异常 |
| UDF 隔离 | 通过（新 UDF 呈现 Kimi 首次引导页） |
| Kimi Web 0.39 本地实例嵌入（token 鉴权） | 通过，导航完成 6.2s 全链路 |
| ACP 全链路（initialize/session-new/session-prompt/stopReason） | 通过 |
| 冷启动到窗口可见 | 1.07s |
| 常驻内存（嵌 kimi web） | 1400 MB vs Electron 1698 MB（-21%） |
| 分发体积 | 1.7 MB（框架依赖）/ 154 MB（自包含）vs 436 MB zip |

## 后果

**正面：** 体积数量级下降；内存省一份 Chromium；宿主能力（窗口/进程/文件/Git）进入强类型系统编程语言；ACP 给 2.0 的 agent 接入一个协议级地基，且对 Claude Code / Codex 有同款潜力（各自 ACP 适配需各自验证）。

**代价与缓解：**

1. **.NET 运行时依赖**：框架依赖 1.7MB 需系统有 .NET 运行时（Windows 不预装）→ 发布用自包含单文件（154MB，可裁剪/ReadyToRun 再降），或安装器引导。打包决策在 2.0 打包设计时定。
2. **AI 编写 C# 的语料弱势**：壳必须保持薄（<15%、长期冻结）；全部产品逻辑在 TS/HTML 层（HMR、AI 最强区）；spike 已踩平两个坑（COM 线程、流重入）并记录在案。
3. **WebView2 Evergreen 依赖**：Windows 11 预装，Win10 近全量覆盖；安装器做运行时检测兜底。
4. **WinForms vs WPF 未决**：spike 用 WinForms（最薄、无 XAML 编译）；若未来壳需要复杂原生 UI 再评 WPF。默认 WinForms 到底。
5. **.NET 版本**：spike 在 SDK 7.0.102 上验证；2.0 开工时装 .NET 8/9 LTS SDK 并以之为目标框架。

## 失败回退（仍然有效）

若 2.0 开发中发现 WebView2 嵌入某 agent 的不可解问题（如特定登录流被拦截）：退回"Electron 壳 + 同一套产品契约"，壳层代码预期 <15%，沉没成本有界。

## 后续动作

1. v0.3.1 §9 与 D-37 更新为指向本 ADR（已随本 ADR 同步）
2. M1 通道表中 Kimi 行更新为"ACP（spike 已验证）"
3. 2.0 walking skeleton 立项：薄壳 + 项目空间首屏 + ACP 接入 Kimi + `.arckeep/` 读写
