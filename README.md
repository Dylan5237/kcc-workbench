<div align="center">
  <img src="./docs/assets/kcc-workbench-logo-20260810.png" width="88" height="88" alt="KCC Workbench">

  <h1>KCC Workbench</h1>

  <p><strong>简体中文</strong> · <a href="./README_EN.md">English</a></p>

  <p><strong>一个 GUI，无缝切换 Kimi Code / Claude Code / Codex</strong></p>
  <p>再用一个人类友好的 AI 产物 Viewer，把生成文件变成可阅读、可比较、可回溯的工作成果。</p>

  <p>
    <a href="https://github.com/Dylan5237/kcc-workbench/actions/workflows/ci.yml"><img src="https://github.com/Dylan5237/kcc-workbench/actions/workflows/ci.yml/badge.svg" alt="Windows CI"></a>
    <img src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4?logo=windows" alt="Windows 10 / 11">
    <img src="https://img.shields.io/badge/status-stable-2EA44F" alt="stable">
    <img src="https://img.shields.io/badge/license-MIT-2EA44F" alt="MIT License">
  </p>

  <p>
    <a href="#快速开始">快速开始</a>
    ·
    <a href="#核心能力">核心能力</a>
    ·
    <a href="https://github.com/Dylan5237/kcc-workbench/releases">下载</a>
    ·
    <a href="./PRIVACY.md">隐私</a>
    ·
    <a href="./SECURITY.md">安全</a>
  </p>
</div>

> [!IMPORTANT]
> KCC Workbench 是非官方社区项目，与 Moonshot AI、Anthropic、OpenAI 或 CloudCLI 项目不存在隶属、合作或背书关系。相关名称与标识归各自权利人所有。

## 两个核心特性

> **01 · Kimi Code / Claude Code / Codex，无缝切换，同一个 GUI**
>
> Kimi Web 与 CloudCLI 作为独立常驻视图运行。在同一个桌面窗口里使用 Kimi Code、Claude Code 和 Codex；点击左上角 Logo 或按 `Alt+Q` 切换入口，不必反复打开窗口，也不会重载已经打开的会话。

> **02 · 人类友好的 AI 产物 Viewer**
>
> Viewer 自动跟随当前会话的项目目录，把散落的 AI 生成文件组织成实时文件树、渲染预览、源码视图和逐行 Diff。Markdown、Mermaid、JSON、HTML、图片复制、本轮产物与时间机器集中在一个界面里，让人真正看得懂、审得动、找得回。

## 为什么需要它

Kimi Code、Claude Code 和 Codex 各自具备完整工作流，但入口、会话和产物分散。KCC Workbench 不替代这些工具，而是在本地提供统一桌面壳：Kimi 使用本机 Kimi Web，Claude Code / Codex 由随包的 CloudCLI 承载。

| 使用场景 | 工作台提供的体验 |
| --- | --- |
| 在 Kimi、Claude Code、Codex 之间切换 | 三套 Coding Agent 共用一个 GUI；Kimi 与 CloudCLI 独立常驻，切换不重载当前页面 |
| 不清楚 Coding Plan 还能用多久 | 手动同步额度，结合历史消耗预测耗尽风险 |
| 配置文件难查、难改、容易误操作 | 用可视化页面管理常用选项，保存前明确确认并备份 |
| 会话生成的文件散落在项目中 | 实时聚合文件树、友好预览、逐行 Diff 与原生复制 |
| 想回看或延续某个历史状态 | 保存产物检查点，并从 Git 项目安全分叉新工作区 |

## 核心能力

| | 能力 | 说明 |
| --- | --- | --- |
| **01** | **三套 Coding Agent，一个 GUI** | 在同一个窗口使用 Kimi Code / Claude Code / Codex；Kimi Web 与 CloudCLI 各自常驻，点击左上角 Logo 或按 `Alt+Q` 切换入口，不重新加载会话。 |
| **02** | **Coding Plan 额度** | Kimi 引擎下按需同步总额度、Kimi / Code 分项、5 小时与 7 天额度；不会在后台自动抓取。 |
| **03** | **Quota Autopilot** | 在本地保存额度样本，根据消耗速度估算风险，让“剩余百分比”变成更直观的使用节奏提示。 |
| **04** | **Kimi 可视化配置** | Kimi 引擎下管理模型、思考、Agent、权限、MCP、Skills、Hooks（本版仅只读）、工作区和系统提示词；仅在主动保存时写入。 |
| **05** | **人类友好的 AI 产物 Viewer** | 跟随当前 Kimi 或 CloudCLI 会话目录，渲染 Markdown / Mermaid、JSON 和 HTML，并支持筛选、源码/预览切换、逐行 Diff、图片复制与 Windows 原生文件复制。 |
| **06** | **任务时间机器** | 持久化会话产物检查点，回看历史内容与 Diff；在 Git 项目中可从检查点创建隔离的 branch + worktree。 |

### 两个常驻引擎，共用一个 Viewer

```text
Kimi Web ─────┐
              ├── 当前会话目录 ──▶ 文件查看器 / 会话产物 / 时间机器
CloudCLI ─────┘

Kimi 专属：Coding Plan 额度 / 重启首页 / 系统设置
```

点击左上角 Logo 或按 `Alt+Q` 在 Kimi 与 CloudCLI 间切换。设置、重启首页和额度只在 Kimi 首页显示。

## 快速开始

### 1. 准备环境

- Windows 10 / 11 x64
- 已安装 Kimi Code CLI
- 在 PowerShell 中运行 `kimi web` 可以正常打开本地 Web UI
- 无需全局安装 CloudCLI；`@cloudcli-ai/cloudcli` 已作为应用依赖打包
- **当前仍需本机提供兼容的 Node.js 22 runtime 才能启动 CloudCLI**；Node 缺失或 ABI 不匹配时 Kimi 仍可用，但 CloudCLI 会进入错误页
- 使用额度同步时，可以访问 `https://www.kimi.com`

### 2. 下载并运行

前往 [Releases](https://github.com/Dylan5237/kcc-workbench/releases) 下载对应版本的 Windows zip 包。解压后运行 `KCC Workbench.exe`；KCC 版本的产物名为 `KCC-Workbench-*-x64.zip`。

> [!TIP]
> 首次进入后先确认 Kimi 首页可用，再切到 CloudCLI 完成其账号设置或登录。额度信息不会自动同步，只在 Kimi 首页手动更新。

### 3. 开始使用

1. 在首页打开 Kimi 会话，或切到 CloudCLI 打开 Claude Code / Codex 会话。
2. 切换到“文件查看器”，工作台会优先使用当前引擎所选会话的项目目录。
3. 在“本轮产物”中查看新增、修改、删除和逐行 Diff。
4. 需要调整 Kimi Code 时切回 Kimi，再进入“系统设置”；检查改动后点击“保存设置”。

Kimi 通过会话 API 解析工作目录；CloudCLI 优先使用 `/session/:id` 与其同源会话详情 API，JSONL 活动仅作回退。如果仍无法识别，Viewer 保留上次目录。诊断记录位于 `%APPDATA%\KCC Workbench\viewer-context.log`。

## 功能细节

<details>
<summary><strong>Coding Plan 额度与预测</strong></summary>

- 从 Kimi 额度页面读取总额度、Kimi / Code 分项、5 小时额度、7 天额度与对应重置时间。
- 使用 Electron 持久会话保持登录状态，不把 Cookie 写入额度历史 JSON。
- 只有点击“更新信息”才会访问额度页面，不进行后台定时抓取。
- Quota Autopilot 仅基于本机保存的历史样本计算，样本不足时不会生成误导性的预测。

</details>

<details>
<summary><strong>可视化配置</strong></summary>

- 仅服务 Kimi Code；CloudCLI 激活时设置入口隐藏且主进程拒绝打开。
- 常规、模型与思考、Agent 执行、权限与工具。
- 模型编辑器：增删改 `[models."alias"]` 第三方模型（model / display_name / provider / api_key / base_url / max_context_size / capabilities），安全别名校验并保留未知配置。
- MCP 服务、Skills、Hooks、工作区与高级诊断。
- 用户级 `SYSTEM.md` 和全局 `AGENTS.md` 系统提示词。
- 所有编辑均需手动保存；覆盖前生成 `.bak` 备份。
- Demo 与自动化测试使用隔离配置目录，不触碰真实 Kimi 配置。

</details>

<details>
<summary><strong>文件查看器与会话产物</strong></summary>

- Markdown 友好视图、源文件视图与 Mermaid 图表。
- JSON 表格、树形和原文三种视图。
- HTML 安全预览与源码视图；默认禁用脚本、表单和外部网络。
- 文件树实时监听、名称筛选、宽度调节、复制路径和 Windows 原生文件复制。
- “本轮产物”聚合新增、修改、删除及逐行 Diff。

</details>

<details>
<summary><strong>任务时间机器</strong></summary>

- 按当前 Kimi / CloudCLI 会话持久化产物检查点。
- 回放 Markdown、JSON、HTML 的历史内容和文件级 Diff。
- Git 项目保存受限大小的 patch 与未跟踪文件快照。
- 从任意检查点创建隔离的 branch + worktree 继续开发。
- 不提供覆盖当前项目目录的直接回滚，避免误伤现有工作。

</details>

## 数据与安全边界

| 数据或操作 | 处理方式 |
| --- | --- |
| Kimi Web | 首页只连接本机 `127.0.0.1（随机端口）`，网络行为由本机 Kimi Code 服务负责 |
| CloudCLI | 应用启动随包的本地 CloudCLI 服务；提供商请求、账号和认证由 CloudCLI 及其配置负责 |
| Viewer 上下文日志 | 本地记录引擎、会话标识、项目绝对路径和 API/回退状态，不记录 Token 或 Cookie |
| 额度登录状态 | 由 Electron Chromium 持久会话管理，不写入额度历史文件 |
| 额度同步 | 仅在用户点击更新时访问 Kimi 额度页面 |
| 配置修改 | 仅在点击保存后写入，覆盖前创建 `.bak` 备份 |
| HTML 预览 | 使用 sandbox、CSP 与资源白名单，不执行页面脚本 |
| 时间机器 | 快照只保存在本机应用数据目录，但可能包含项目文件内容 |
| Git 分叉 | 显示确认后创建新的 branch + worktree，不改写当前工作区 |

完整说明请阅读 [隐私说明](./PRIVACY.md) 与 [安全策略](./SECURITY.md)。提交 Issue 前，请删除日志中的账号、Cookie、Token、项目源码和本机绝对路径。

## 从源码运行

开发环境需要 Node.js 22 和 npm。

```powershell
git clone https://github.com/Dylan5237/kcc-workbench.git
cd kcc-workbench
npm ci
npm test
npm start
```

使用隔离配置启动 Demo：

```powershell
npm run demo -- --demo-profile=manual-test
```

构建 Windows 解包版本：

```powershell
npm run build
& ".\dist\win-unpacked\KCC Workbench.exe"
```

构建 zip 发布包（推荐一键打包）：

```powershell
npm run pack          # 一键：跑测试 -> 清理 dist -> 打包 -> 报告产物路径与大小
npm run pack -- fast  # 快速：跳过测试/zip 压缩 -> dist-fast/win-unpacked
```

也可在仓库根目录运行 `pack.bat fast` 做日常快速验证，直接启动 `dist-fast/win-unpacked/KCC Workbench.exe`；双击 `pack.bat` 执行正式 zip 打包。完整打包仅需跳过测试时可用 `pack.bat --no-test`。快速模式仍会清理自己的 `dist-fast/`，不会复用陈旧产物。

推送和 Pull Request 会在 GitHub Actions 的 Windows 环境中执行测试与构建；推送 `v*` 标签会触发 zip Release 工作流。

## 常见问题

<details>
<summary><strong>这是 Kimi 官方客户端吗？</strong></summary>

不是。本项目是独立开发的非官方桌面工作台，不代表 Moonshot AI / Kimi。

</details>

<details>
<summary><strong>工作台会在后台自动获取额度吗？</strong></summary>

不会。只有点击额度窗口中的“更新信息”才会同步，预测也完全基于本地历史样本完成。

</details>

<details>
<summary><strong>打开系统设置会修改我的 Kimi 配置吗？</strong></summary>

不会。浏览和编辑草稿不会写入文件；只有主动点击“保存设置”才会写入，并在覆盖前创建备份。

</details>

<details>
<summary><strong>必须全局安装 CloudCLI 吗？</strong></summary>

不需要，CloudCLI npm 依赖已随应用打包。但当前版本尚未内置 Node runtime，仍要求本机有兼容的 Node.js 22；这是发布前需要消除的已知限制。

</details>

<details>
<summary><strong>时间机器会直接回滚项目吗？</strong></summary>

不会。它提供历史回放；需要继续开发时，会在 Git 仓库中创建新的隔离 worktree，而不是覆盖当前目录。

</details>

## 项目状态与参与

项目已发布 **v1.0.0** 稳定版，优先保证 Windows 上的本地单用户工作流。KCC 双引擎与 zip 打包改造已合入 `main` 并通过 Windows CI；Kimi / Claude Code / Codex 真实登录会话、Viewer 路径与 RC 干净环境验收均已完成。当前两项已知限制：兼容的 Node.js 22 runtime 尚未内置（CloudCLI 需系统 Node 22 / ABI 127），以及 CloudCLI 传递前端依赖仍保留 4 个 moderate 安全公告（上游暂无修复版本）。欢迎通过：

- [GitHub Issues](https://github.com/Dylan5237/kcc-workbench/issues) 报告 Bug 或提出功能建议
- [Pull Requests](https://github.com/Dylan5237/kcc-workbench/pulls) 提交聚焦、可验证的改进
- [Changelog](./CHANGELOG.md) 查看当前版本的功能范围

## 许可

本项目自有代码采用 [MIT License](./LICENSE)。随包第三方组件（包括 CloudCLI）仍适用各自许可证；分发二进制时必须同时满足这些许可证要求。

---

<div align="center">
  <sub>Kimi Code · Claude Code · Codex, in one local Windows workbench.</sub>
</div>
