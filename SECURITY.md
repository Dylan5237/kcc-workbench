# Security Policy

## Supported Versions

项目处于早期阶段，目前只对最新发布版本提供安全修复。

## Reporting a Vulnerability

请不要在公开 Issue 中提交可利用的漏洞细节、Cookie、Token、私人源码或完整日志。

优先通过 GitHub 的私密漏洞报告功能联系维护者：

1. 打开仓库的 **Security**
2. 选择 **Report a vulnerability**
3. 提供受影响版本、复现步骤、影响范围和建议修复方式

如果私密漏洞报告尚未启用，请先创建一个不包含漏洞细节的普通 Issue，请求维护者提供私密沟通渠道。

## Security Boundaries

- Kimi.com 登录会话由 Electron Chromium 管理
- CloudCLI 登录 Token 只在其同源页面内用于本地 API 请求，不应写入日志
- CloudCLI 当前会话目录必须来自所选路由会话，JSONL 最近活动只能作为回退
- HTML 预览不应执行脚本、表单或外部网络请求
- Viewer API 只应访问当前项目根目录内的白名单文件
- 时间机器的 Git 分叉只应在用户明确确认后执行
- 自动测试必须使用临时目录，不应读写真实 Kimi Code 配置
- 公开日志前必须移除会话标识、本机绝对路径和项目内容

