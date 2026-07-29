<div align="center">
  <img src="./docs/assets/app-icon.png" width="88" height="88" alt="Kimi Desktop Workbench">

  <h1>Kimi Desktop Workbench</h1>

  <p><strong>简体中文</strong> · <a href="./README_EN.md">English</a></p>

  <p><strong>Kimi Code 的非官方本地桌面工作台</strong></p>
  <p>把 Kimi Web、Coding Plan 额度、可视化配置、会话产物与时间机器放进一个 Windows 应用。</p>

  <p>
    <a href="https://github.com/Dylan5237/kimi-code-workbench/actions/workflows/ci.yml"><img src="https://github.com/Dylan5237/kimi-code-workbench/actions/workflows/ci.yml/badge.svg" alt="Windows CI"></a>
    <img src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4?logo=windows" alt="Windows 10 / 11">
    <img src="https://img.shields.io/badge/status-Beta-F59E0B" alt="Beta">
    <img src="https://img.shields.io/badge/license-UNLICENSED-lightgrey" alt="UNLICENSED">
  </p>

  <p>
    <a href="#快速开始">快速开始</a>
    ·
    <a href="#核心能力">核心能力</a>
    ·
    <a href="https://github.com/Dylan5237/kimi-code-workbench/releases">下载</a>
    ·
    <a href="./PRIVACY.md">隐私</a>
    ·
    <a href="./SECURITY.md">安全</a>
  </p>
</div>

> [!IMPORTANT]
> Kimi Desktop Workbench 是非官方社区项目，与 Moonshot AI / Kimi 官方不存在隶属、合作或背书关系。Kimi、Kimi Code 及相关名称与标识归其权利人所有。

## 为什么需要它

Kimi Code 已经具备完整的终端与 Web 工作流，但额度、配置和会话产物分散在不同入口。Kimi Desktop Workbench 不替代 Kimi Code，而是在本地为它补上一层统一的桌面工作区：

| 使用场景 | 工作台提供的体验 |
| --- | --- |
| 在浏览器与终端之间切换 | 自动启动并嵌入本机 Kimi Web，保留原有会话体验 |
| 不清楚 Coding Plan 还能用多久 | 手动同步额度，结合历史消耗预测耗尽风险 |
| 配置文件难查、难改、容易误操作 | 用可视化页面管理常用选项，保存前明确确认并备份 |
| 会话生成的文件散落在项目中 | 实时聚合文件树、友好预览、逐行 Diff 与原生复制 |
| 想回看或延续某个历史状态 | 保存产物检查点，并从 Git 项目安全分叉新工作区 |

## 核心能力

| | 能力 | 说明 |
| --- | --- | --- |
| **01** | **Kimi Web 桌面工作区** | 自动启动或复用 `kimi web`，在固定首页中延续 Kimi Code 会话；同时提供文件查看器、系统设置和系统托盘。 |
| **02** | **Coding Plan 额度** | 按需同步总额度、Kimi / Code 分项、5 小时与 7 天额度；不会在后台自动抓取。 |
| **03** | **Quota Autopilot** | 在本地保存额度样本，根据消耗速度估算风险，让“剩余百分比”变成更直观的使用节奏提示。 |
| **04** | **可视化系统配置** | 管理模型、思考、Agent、权限、MCP、Skills、Hooks、工作区和系统提示词；仅在主动保存时写入。 |
| **05** | **产物与文件查看器** | 实时监听项目目录，渲染 Markdown / Mermaid、JSON 和 HTML，并支持筛选、源文件视图、逐行 Diff 与 Windows 原生文件复制。 |
| **06** | **任务时间机器** | 持久化会话产物检查点，回看历史内容与 Diff；在 Git 项目中可从检查点创建隔离的 branch + worktree。 |

### 一个窗口，三种固定工作视图

```text
首页（Kimi Web） ── 当前项目上下文 ──▶ 文件查看器 / 会话产物 / 时间机器
       │
       ├── 点击额度组件 ────────────▶ Coding Plan 手动同步与预测
       │
       └── 系统设置 ────────────────▶ Kimi Code 可视化配置
```

## 快速开始

### 1. 准备环境

- Windows 10 / 11 x64
- 已安装 Kimi Code CLI
- 在 PowerShell 中运行 `kimi web` 可以正常打开本地 Web UI
- 使用额度同步时，可以访问 `https://www.kimi.com`

### 2. 下载并运行

前往 [Releases](https://github.com/Dylan5237/kimi-code-workbench/releases) 下载最新的 `Kimi-Desktop-*-x64.exe`，双击即可运行。当前发布物为免安装便携版。

> [!TIP]
> 首次进入后，先确认首页能够加载 Kimi Web。额度信息不会自动同步，需要点击标题栏右侧的“额度”，再点击“更新信息”。

### 3. 开始使用

1. 在“首页”创建或打开 Kimi Code 会话。
2. 切换到“文件查看器”，工作台会优先使用当前会话对应的项目目录。
3. 在“本轮产物”中查看新增、修改、删除和逐行 Diff。
4. 需要调整 Kimi Code 时进入“系统设置”；检查改动后再点击“保存设置”。

如果无法识别当前项目，文件查看器会保留上次打开的目录；没有历史目录时保持为空，等待手动选择。

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

- 常规、模型与思考、Agent 执行、权限与工具。
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

- 按 Kimi 会话持久化产物检查点。
- 回放 Markdown、JSON、HTML 的历史内容和文件级 Diff。
- Git 项目保存受限大小的 patch 与未跟踪文件快照。
- 从任意检查点创建隔离的 branch + worktree 继续开发。
- 不提供覆盖当前项目目录的直接回滚，避免误伤现有工作。

</details>

## 数据与安全边界

| 数据或操作 | 处理方式 |
| --- | --- |
| Kimi Web | 首页只连接本机 `127.0.0.1:5494`，网络行为由本机 Kimi Code 服务负责 |
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
git clone https://github.com/Dylan5237/kimi-code-workbench.git
cd kimi-code-workbench
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
& ".\dist\win-unpacked\Kimi Desktop.exe"
```

构建便携发布包：

```powershell
npm run dist
```

推送和 Pull Request 会在 GitHub Actions 的 Windows 环境中执行测试与构建；推送 `v*` 标签会触发便携版 Release 工作流。

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
<summary><strong>时间机器会直接回滚项目吗？</strong></summary>

不会。它提供历史回放；需要继续开发时，会在 Git 仓库中创建新的隔离 worktree，而不是覆盖当前目录。

</details>

## 项目状态与参与

项目目前处于 **Beta** 阶段，优先保证 Windows 上的本地单用户工作流。欢迎通过：

- [GitHub Issues](https://github.com/Dylan5237/kimi-code-workbench/issues) 报告 Bug 或提出功能建议
- [Pull Requests](https://github.com/Dylan5237/kimi-code-workbench/pulls) 提交聚焦、可验证的改进
- [Changelog](./CHANGELOG.md) 查看当前版本的功能范围

## 许可

当前仓库标记为 `UNLICENSED`。代码公开可见不代表授予复制、修改、分发或商业使用许可；后续如切换到开源许可证，将通过独立版本说明。

---

<div align="center">
  <sub>Built for a focused Kimi Code workflow on Windows.</sub>
</div>
