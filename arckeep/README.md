# Arckeep

Arckeep 的最小端到端真身（骨架 → M1）：一个能开的窗口、真实数据的项目空间、经 ACP 送达 Kimi 的简报、Kimi Web 原生界面嵌入、真实读写的 `.arckeep/`。

依据：`docs/ARCKEEP_DESIGN_V0.3.md`（v0.3.1）+ `docs/adr/ADR-001-host-stack.md` + `docs/brand/`（品牌 v1.0）。
不是原型：没有 mock 数据，所有状态来自真实文件系统与真实 ACP 会话。

## 运行

```bash
cd arckeep/shell
dotnet build -c Release
./bin/Release/net7.0-windows/Arckeep.exe
```

前置：Windows 10/11（WebView2 Runtime）、.NET SDK 7+、kimi CLI ≥0.39 在 PATH 中。

## 已验证（2026-08-28，截图证据在 spike/results/）

骨架（skeleton-*.png）：
1. 空态 → 选择目录 → 项目即存在（创建 `.arckeep/`，含告知文案）
2. 项目空间真实数据：状态（`status.md`）、待办（`next.json`）、最近产出（文件系统，标"观察"）
3. 改写状态 → 原子写入 `status.md`
4. 开始 → 简报写 `context.md`（已生成）→ ACP `session/new`+`session/prompt`（已交付，sessionId 为证）→ 流式事件 → `stopReason`（已完成）→ 追加 `sessions.json`
5. 回到项目 → 文件系统 diff 回流（标"观察"，无归因冒充）

M1（m1-*.png、ui-debug-rail.png）：
6. 接入态布局：左侧 Kimi Web 原生界面（独立 UDF，spike-agent.png 为嵌入证据）+ 右侧 320px 项目侧轨（R.1 本项目 / R.2 会话状态 / R.3 文件变化 / R.4 接回项目，事件日志折叠在调试 details 里）
7. 待办交互：悬停出"确认 ✓ / 忽略 ×"（忽略归档到 `.arckeep/history/next-archive.json`）、回车添加自己的待办、点选=本轮采用
8. 回到项目后"本轮变化"区块列出真实文件差异

M1.5（m2-titlebar.png、quota-fixture.json、quota-debug 日志）：
9. **额度模块移植**（v1 quota-* → C#）：隐藏 WebView2 抓 kimi.com 额度页，官方 stats API 与 DOM 提取双通道竞速；提取脚本以资产文件携带（`assets/quota-extract.js`），fixture 自测通过；cookie 落持久 UDF，登录窗共享之
10. **HTML 标题栏**（无边框窗口）：拖动/双击最大化/最小化/关闭走桥接，边缘缩放 WM_NCHITTEST，最大化不遮任务栏；额度 chip 在标题栏右侧（v1 同款位置形态），失败可见（chip 显示"同步失败"+原因）
11. **kimi web 端口持久化**（v1 同款）：端口稳定 → origin 稳定 → 初始化向导只做一次；端口被占时经 token+meta 验明后复用既有实例
12. **额度分项放宽**：kimi.com 现版页面不再给出 Kimi/Code 分项数字（纯视觉条），分项缺失不再判未就绪；chip 只需 5h/7d/总额/套餐（真实账号验证：Allegro 12.08% / 10.51% / 57.42%）
13. **追问通道**：接入态侧轨 R.3「继续对话」输入框，ACP 同一 session 续聊（turn 结束 ≠ 会话结束）；全文在左侧 Kimi 原生界面看

## 自动验证钩子（供 vibecoding 闭环）

```bash
ARCKEEP_AUTO=1 ARCKEEP_SHOT=<final.png> ARCKEEP_SHOT_EARLY=<mid.png> [ARCKEEP_SHOT_EARLY_MS=40000] [ARCKEEP_DUMP=<dom.json>] ./Arckeep.exe
ARCKEEP_QUOTA_FIXTURE=<out.json> ./Arckeep.exe   # 额度提取 fixture 自测，exit 0=通过
```

## 踩坑记录（后续开发别再踩）

1. WebView2 的 COM 初始化必须在 UI 线程（`form.Shown` 里做）；`TaskScheduler.FromCurrentSynchronizationContext()` 在线程池线程上会炸——所有碰布局的代码先 `InvokeAsync` 回 UI 线程
2. 子进程 stdout 读取：后台 Pump + 共享缓冲；**显式 UTF-8 编码**（GBK 系统上中文乱码）
3. 桥接序列化用 camelCase 命名策略，C# PascalCase 不会自动变小写
4. `Environment.Exit` 不触发 `FormClosed`——外部子进程（kimi web）要在看门狗路径显式杀
5. 隐藏 WebView2 的宿主窗体**不能设 `Opacity=0`**（不合成 → `EnsureCoreWebView2Async` 挂死）；用离屏坐标（-32000）即可
6. **禁止在 WebView2 事件回调里初始化新 WebView2**（E_ABORT 重入保护）：桥消息先 `BeginInvoke` 出队再处理。Electron 的 IPC 无此约束——这是两个平台的真实差异，移植窗口编排代码时必须重新验证真实触发路径
7. 验证前先看二进制新不新鲜：实例运行中构建会写不进去（error MSB3027，不是 CS 错误），构建输出过滤别只看 `error CS`
8. 页面加载完成前 PostWebMessageAsJson 会丢：启动期的状态推送改为在 `ui-ready` 里应答式补发

## 结构

```
shell/
  Program.cs         入口
  ShellWindow.cs     窗口、双 WebView2 布局切换、桥接、ACP 编排、fs diff 回流
  KimiWebService.cs  kimi web 按需启动（视觉平面）
  ProjectStore.cs    .arckeep/ 读写（原子写、待办确认/忽略/添加、会话记录）
  AcpClient.cs       ACP 客户端（控制平面）
ui/                  原生 HTML/JS（品牌 v1.0，无构建步骤）
  index.html         空态 / 项目空间 / 侧轨模板
  app.css            品牌 tokens + 组件
  app.js             桥接、渲染、交互
```

## 已知边界（M1 不做，后续里程碑）

- 侧轨"文件变化"暂在回流后显示，不做会话中实时刷新
- 关键判断的添加/确认交互未做（只读展示）
- Session Map / Viewer / 时间机器未接入
- 单项目单会话锁（M4.4）未实现
- `next.json`/`decisions.json` 暂用 JSON；理解类的 Markdown 列表语法留待认真设计
- 目标框架暂定 net7.0（本机 SDK），生产目标 .NET 8/9 LTS
