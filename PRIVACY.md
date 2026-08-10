# 隐私说明

KCC Workbench 是本地桌面工具。以下内容用于说明应用处理的数据及其保存位置。

## 本地处理的数据

- Kimi Code 本地 Web UI 的连接信息
- CloudCLI 本地 Web UI、当前会话标识和项目目录
- 用户手动同步的 Coding Plan 额度与同步历史
- Kimi.com 的 Chromium 登录会话
- Viewer 最近打开的项目目录
- 系统设置草稿与用户明确保存的配置备份
- 会话产物记录、文件 Diff 和任务时间机器快照

## 网络访问

- Kimi Code 主页面连接本机 `127.0.0.1（随机端口）`
- 额度信息仅在用户点击“更新信息”时访问 Kimi.com
- HTML 历史预览默认禁用脚本、表单和外部网络
- 本项目本身不提供遥测、广告或远程分析服务
- CloudCLI 的提供商请求、认证和网络行为由随包运行的 CloudCLI 服务及其配置负责

## 敏感信息

时间机器为了支持回放和 Git worktree 分叉，可能在本机保存受限大小的文件内容、Git patch 及未跟踪文件。不要在不受信任的电脑上启用或保留包含敏感源码的快照。

应用不会将 Cookie 写入普通 JSON 文件，但 Chromium 会话数据仍属于敏感本机数据。不要分享完整应用数据目录。

## 删除数据

退出应用后，可以删除 `%APPDATA%\KCC Workbench` 来清除额度缓存、Viewer 历史、网页登录会话、上下文诊断日志和时间机器快照。执行前请确认不再需要其中的本地历史数据。

从旧版 “Kimi Desktop” 升级时，首次启动会自动将历史用户数据从旧目录 `%APPDATA%\Kimi Desktop` 拷贝到 `%APPDATA%\KCC Workbench`（拷贝而非移动，旧目录会保留）。如需彻底清除本机数据，请将两个目录一并删除。

## Issue 与日志

公开提交 Issue 前，请删除：

- Cookie、Token 和认证头
- 账号、额度和账单信息
- 项目源码、系统提示词与 Git patch
- 用户名、本机绝对路径和会话标识

`viewer-context.log` 会记录引擎、会话标识、项目绝对路径、API 状态和回退来源，但不得记录认证 Token 或 Cookie。公开分享前必须脱敏。
