# 内置 Node.js 22 验收方案（仅文档）

> 目标：评估是否把 Node.js 22 runtime 随 KCC 打包，从而消除“CloudCLI 需要系统 Node 22”的主要门槛。
> 本文件只描述验收方案，不包含实现代码。

## 背景

CloudCLI 已随应用打包，但运行它需要系统 Node.js 22 / ABI 127。用户若没有合适 Node，Claude Code 与 Codex 无法使用，首次成功率下降。

## 候选方案

### 方案 A：随包绑定 Node runtime

- 在安装包内附带一个与本机无关的 Node 22 二进制。
- CloudCLI 启动时优先用随包 Node，找不到再用系统 Node。

优点：干净环境开箱即用；缺点：增加 zip 体积，需处理不同架构与许可证。

### 方案 B：引导安装系统 Node 22

- Doctor 检测到缺 Node 时给出安装/降级命令。
- 不增加体积，但用户仍需手动安装。

### 方案 C：混合

- 默认引导安装系统 Node 22。
- 提供可选的随包 Node 下载开关，供离线或受控环境使用。

## 验收步骤

### 1. 用随包 Node 启动 CloudCLI

- 将 Node 22 二进制放入临时目录。
- 用其 `node` 启动 CloudCLI，确认能进入 Claude Code / Codex 会话。

### 2. 验证 ABI 与原生依赖

- 检查 `process.versions.modules` 是否为 127。
- 确认 CloudCLI 依赖的 `better-sqlite3`、`node-pty` 等原生模块在该 Node 下可加载。

### 3. 测量体积增量

- 记录加入随包 Node 前后的 zip 大小。
- 评估是否可接受。

### 4. 干净环境验证

- 在无系统 Node 的 Windows 上解压并启动，确认 CloudCLI 可用。

### 5. 许可证与分发

- 核对 Node.js 二进制许可证是否允许随应用分发。
- 确认不需要额外声明。

## 推出的前置条件

- 至少通过上述 1–5 的干净环境验证。
- 给出 zip 体积增量与利弊说明，由维护者决定是否正式内置。

## 不做的事

- 不把系统 Node 覆盖或替换。
- 不改变 CloudCLI 自身依赖树。
- 不在未验证时宣称“零前置条件”。
