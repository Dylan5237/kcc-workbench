# Kimi Desktop

一个将 Kimi Code 本地 Web UI 与会员额度组件组合起来的 Electron 客户端。

## 功能

- 自动启动 `kimi web --host 127.0.0.1 --port 5494 --no-open`
- 如果 5494 端口已有 Kimi Web，则直接连接而不重复启动
- 使用 `BaseWindow` 对标题栏、Kimi Code 和额度面板进行独立分层
- 自定义 Windows 标题栏
- 固定“首页 / 文件查看器 / 系统设置”三标签工作区
- 文件查看器实时监听项目目录中的 Markdown 和 JSON 变化
- Markdown 渲染与 JSON 表格、树形、原文三视图
- Markdown 中的 Mermaid 代码块自动渲染为图表
- 文件树筛选、宽度调节、复制路径，以及兼容资源管理器的 Windows 文件复制
- 打开文件查看器时优先识别当前 Kimi 会话的项目目录，识别不到则沿用上次目录
- 标题栏额度小组件
- 手动同步总额度、Kimi / Code 分项、5 小时和 7 天额度
- 首次同步时如缺少 `kimi.com` Cookie，会打开一次性网页登录窗口
- `kimi.com` 持久登录会话仅供额度 Worker 使用
- 本地额度缓存
- Quota Autopilot 本地燃尽预测
- 可视化管理常规、模型与思考、Agent 执行、权限工具、MCP、Skills 等配置
- “系统提示词”一级菜单，可编辑 `SYSTEM.md` 与全局 `AGENTS.md`
- 配置只在点击“保存设置”后写入，保留 `.bak` 备份；演示与自动测试使用隔离目录

## 隐私与联网

- 主页面连接本机 `127.0.0.1:5494`，网络行为由 Kimi Code 服务负责。
- 额度页面不会自动抓取，只有点击“更新信息”才会加载。
- 预测完全在本地根据手动同步历史计算。
- `kimi.com` Cookie 由 Electron Chromium 持久会话管理，不会写入额度 JSON。

## 开发

```powershell
npm install
npm test
npm run demo
npm run build
```

`npm run demo` 会把系统设置写入临时沙箱。正常启动时，设置页会读取
`$KIMI_CODE_HOME`（未设置时为 `~/.kimi-code`），但不会自动写入。
