# Changelog

## Unreleased

### Added

- KCC 双引擎首页：Kimi Code 与 CloudCLI（Claude Code / Codex）使用独立常驻视图，可通过左上角 Logo 或 `Alt+Q` 切换
- CloudCLI 当前路由会话到 Viewer 项目目录的同步，以及 `%APPDATA%\KCC Workbench\viewer-context.log` 诊断日志
- Viewer 支持 `.mmd` / `.mermaid` 文件、Mermaid 图片复制、源码/图表切换和 ELK 布局

### Changed

- 产品名与 Windows 产物名改为 KCC Workbench / `KCC-Workbench-*.exe`
- 设置、重启首页和额度仅在 Kimi 引擎可用

### Known limitations

- CloudCLI npm 依赖已随应用打包，但兼容的系统 Node.js 22 runtime 尚未内置；缺失或 ABI 不匹配时 CloudCLI 无法启动
- CloudCLI 路由会话同步已通过单元测试和未登录回退日志验收，真实登录配置下的 API 200 路径仍待发布前人工验收

## 1.0.0-beta.2

产品更名为 KimiCode Workbench，完成首轮对抗性安全审查（RT-001~017）修复，并新增第三方模型编辑器。

### Added

- 第三方模型编辑器：模型与思考面板可增删改 `[models."alias"]` 节（model / display_name / provider / api_key / base_url / max_context_size / capabilities）
- 首页新增"重启 Kimi Web 服务"按钮
- 文件查看器右键菜单新增"放入回收站"
- 一键打包脚本 pack.bat（进度条 + 占用重试 + 文档）

### Changed

- 产品重命名 Kimi Desktop → KimiCode Workbench，旧版用户数据自动迁移
- 文件树、全量快照与时间机器读写异步化，大仓库不再冻结主进程
- 标题栏标签简化为 首页 / 文件 / 设置

### Fixed

- Viewer 本地服务安全加固：Host 头校验 + 启动 Token + HttpOnly Cookie 会话认证 + realpath 路径包含检查（RT-001）
- Kimi Web 就绪探测改用随机端口，并在就绪后校验端口监听者确为本子进程（RT-002）
- 时间机器恢复未跟踪文件时校验符号链接逃逸（RT-008）
- Viewer HTTP 请求补全局兜底，同步抛错不再升级为进程崩溃（RT-009）
- 额度登录窗限制为 kimi.com 域名白名单，persist:kimi 会话权限收紧（RT-004 / RT-005）
- TOML 补丁支持引号节名，避免写重复节导致配置非法（RT-014）
- 窗口状态校验 x/y 坐标，避免恢复到屏外（RT-016）
- kimi-web 日志 5 MB 截断（RT-017）
- README 能力表勘正与实现不符的声称（RT-003 / RT-015）
- 退出流程等待时间机器 checkpoint 落盘后再退出
- 构建链依赖升级：electron-builder 26.0.12 → ^26.15.3，npm audit 0 已知漏洞（RT-012）

### Notes

- Windows 10 / 11 x64
- 需要本机已安装 Kimi Code CLI
- 当前版本为非官方社区 Beta

## 1.0.0-beta.1

首个公开 Beta 版本。

### Added

- Kimi Code 本地 Web UI 桌面封装
- Coding Plan 手动额度同步和 Quota Autopilot 预测
- Kimi Code 可视化系统配置与系统提示词管理
- Markdown、Mermaid、JSON、HTML 文件阅读器
- Windows 原生文件复制
- 当前会话产物时间线和逐行 Diff
- 持久化任务时间机器及 Git worktree 安全分叉

### Notes

- Windows 10 / 11 x64
- 需要本机已安装 Kimi Code CLI
- 当前版本为非官方社区 Beta
