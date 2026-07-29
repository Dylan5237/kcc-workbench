# Kimi Desktop Workbench

Kimi Code 的非官方本地桌面工作台。集成 Kimi Web、Coding Plan 额度跟踪与超额预测、Kimi Code 可视化配置、会话产物 Diff、常用文件阅读器，以及基于会话产物时间线的“时间旅行”。

> [!IMPORTANT]
> 本项目是非官方社区工具，与 Moonshot AI / Kimi 官方不存在隶属、合作或背书关系。Kimi、Kimi Code 及相关标识归其权利人所有。

## 功能

### Kimi Code 桌面工作区

- 自动启动 `kimi web --host 127.0.0.1 --port 5494 --no-open`
- 端口已有 Kimi Web 时直接复用，避免重复启动
- 固定“首页 / 文件查看器 / 系统设置”三标签工作区
- 自定义 Windows 标题栏、额度组件和系统托盘

### Coding Plan 额度

- 手动同步总额度、Kimi / Code 分项、5 小时额度和 7 天额度
- 本地保存同步历史
- Quota Autopilot 根据历史消耗速度预测额度耗尽风险
- 不进行后台自动抓取，只有点击“更新信息”才访问额度页面

### 可视化配置

- 管理常规、模型与思考、Agent 执行、权限工具等选项
- 管理 MCP、Skills、Hooks 和工作区设置
- “系统提示词”一级菜单，可编辑用户级 `SYSTEM.md` 与全局 `AGENTS.md`
- 仅在点击“保存设置”后写入，并在覆盖前生成 `.bak` 备份
- Demo 和自动测试始终使用隔离配置目录

### 文件与会话产物

- 实时监听当前 Kimi 会话对应的项目目录
- Markdown 渲染、Mermaid 图表和源文件查看
- JSON 表格、树形与原文三视图
- HTML 安全预览与源码视图，默认禁用脚本、表单和外部网络
- 文件树筛选、宽度调节、复制路径和 Windows 原生文件复制
- “本轮产物”聚合新增、修改、删除及逐行 Diff

### 任务时间机器

- 按 Kimi 会话持久化产物检查点
- 回放 Markdown、JSON、HTML 的历史内容和文件级 Diff
- Git 项目保存受限大小的 patch 与未跟踪文件快照
- 从任意检查点创建隔离 branch + worktree 继续开发
- 不提供覆盖当前项目目录的直接回滚

## 系统要求

- Windows 10 / 11 x64
- 已安装并能够在 PowerShell 中运行 `kimi`
- 开发构建需要 Node.js 22 和 npm
- 使用额度同步时需要能够访问 `https://www.kimi.com`

## 安装

从仓库的 [Releases](https://github.com/Dylan5237/kimi-code-workbench/releases) 下载最新 Windows 可执行文件。

目前发布的是便携版，运行后数据保存在 Electron 的 Kimi Desktop 应用数据目录中。

## 从源码运行

```powershell
git clone https://github.com/Dylan5237/kimi-code-workbench.git
cd kimi-code-workbench
npm ci
npm test
npm start
```

演示系统设置时使用隔离配置：

```powershell
npm run demo -- --demo-profile=manual-test
```

构建解包版本：

```powershell
npm run build
& ".\dist\win-unpacked\Kimi Desktop.exe"
```

构建便携发布包：

```powershell
npm run dist
```

## 数据与安全边界

- 主页面只连接本机 `127.0.0.1:5494`，网络行为由本机 Kimi Code 服务负责。
- 额度 Cookie 由 Electron Chromium 的持久会话管理，不写入额度 JSON。
- 时间机器快照可能包含项目文件内容，仅保存在本机应用数据目录。
- HTML 预览使用 sandbox、CSP 和资源白名单，不执行页面脚本。
- 创建时间机器分叉前会明确显示确认框；操作只创建新的 Git worktree。
- 详细说明参见 [PRIVACY.md](PRIVACY.md) 和 [SECURITY.md](SECURITY.md)。

## 开发与验证

```powershell
npm ci
npm test
npm run build
```

推送和 Pull Request 会在 GitHub Actions 的 Windows 环境中执行测试与构建。推送 `v*` 标签会触发便携版 Release 工作流。

## 许可证

当前仓库标记为 `UNLICENSED`。代码公开可见不代表授予复制、修改、分发或商业使用许可。后续如切换到开源许可证，将通过独立版本说明。

## 反馈

- Bug 和功能建议请提交 [GitHub Issue](https://github.com/Dylan5237/kimi-code-workbench/issues)
- 提交问题时请删除日志中的账号、Cookie、Token、项目源码和本机绝对路径
