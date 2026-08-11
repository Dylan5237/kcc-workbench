# 贡献指南 / Contributing

KCC Workbench 是一个非官方、本地优先的 Windows 桌面工作台，让 Kimi Code / Claude Code / Codex 在同一个 GUI 中共存，并用人类友好的 Viewer 沉淀 AI 产物。

任何人都可以参与：报告问题、提功能建议、修文档、补测试、加 Viewer 格式支持、做翻译、适配 Windows 环境。请先阅读本指南，避免重复劳动或方向偏差。

## 目录

- [行为准则](#行为准则)
- [环境准备](#环境准备)
- [提交约定](#提交约定)
- [改动边界](#改动边界)
- [如何报告问题](#如何报告问题)
- [如何提交代码](#如何提交代码)
- [如何参与 Good First Issue](#如何参与-good-first-issue)
- [隐私与安全](#隐私与安全)

## 行为准则

- 尊重所有参与者，评论对事不对人。
- Issue 与 PR 默认使用中文或英文，保持一致即可。
- 不要利用本仓库测试他人账号、Cookie、Token 或私有资源。
- 涉及可执行漏洞细节、私密日志或敏感数据时，走 [SECURITY.md](./SECURITY.md) 的私密通道，不要公开。

## 环境准备

```powershell
git clone https://github.com/Dylan5237/kcc-workbench.git
cd kcc-workbench
npm ci
npm test
npm start
```

- 开发与打包需要 **Node.js 22** 与 npm。
- 体验 Kimi 引擎需要本机已安装 `Kimi Code CLI`，并能在 PowerShell 执行 `kimi web`。
- 体验 CloudCLI（Claude Code / Codex）需要本机有兼容的 Node.js 22 runtime；CloudCLI 已随应用打包，无需全局安装。
- 不接触真实 Kimi 配置：Demo 与自动化测试使用隔离配置目录。

## 提交约定

使用 [Conventional Commits](https://www.conventionalcommits.org/)，一个独立改动一个 commit。

- `feat(scope): 中文标题`
- `fix(scope): 中文标题`
- `docs(scope): 中文标题`
- `test(scope): 中文标题`
- `chore(scope): 中文标题`

标题用中文、紧凑、单行、不加句号。body 用“现象/根因 -> 改法”结构，多子项用编号（T1 / T2）。footer 追加：

```text
Co-Authored-By: Codex <noreply@openai.com>
```

提交作者为仓库配置的维护者身份，不要改动历史提交。

## 改动边界

请先理解架构再动手：

- `src/main/`：Electron 主进程，Kimi / CloudCLI 服务、设置、额度、Viewer 上下文同步。
- `src/renderer/`：标题栏、设置、额度与服务状态页。
- `src/viewer/`：本地认证 Viewer 服务与前端。
- `test/`：Node 测试；必须使用隔离的临时数据，不得读写真实 Kimi 配置。
- `scripts/`：打包、依赖追踪、产物校验等脚本。

约束：

- Kimi 与 CloudCLI 使用独立常驻的 `WebContentsView`，引擎切换不得重载已打开会话。
- 设置、重启首页、额度仅对 Kimi 引擎可用；CloudCLI 激活时设置入口隐藏且主进程拒绝打开。
- Viewer 上下文优先使用所选 `/session/:id` 与其同源会话详情 API；JSONL 活动仅作回退。诊断日志写入 `%APPDATA%\KCC Workbench\viewer-context.log`，不得记录 Token / Cookie。
- 不要退回到 portable exe，也不要将 `asarUnpack` 放回 `node_modules/**`。
- 涉及 CloudCLI 自身前端依赖树时，未经验证不要套用 override，避免破坏其运行。

## 如何报告问题

优先使用 [Issue 模板](https://github.com/Dylan5237/kcc-workbench/issues/new/choose)。

- 描述期望行为与实际表现。
- 给出可复现步骤、KCC 版本、Windows 版本、Node.js 版本。
- 需要时提供脱敏后的 `%APPDATA%\KCC Workbench\viewer-context.log`。
- 公开前必须删除：Cookie、Token、认证头、账号/额度信息、项目源码、系统提示词、Git patch、用户名、本机绝对路径与会话标识。

## 如何提交代码

1. 在 `main` 基础上开独立分支，或直接说明改动范围。
2. 只改与当前任务相关的文件；不混入无关重构、格式化或行尾清理。
3. 运行并新增针对性测试：

   ```powershell
   npm test
   ```

4. 改动影响打包或运行时行为时，运行构建：

   ```powershell
   npm run build
   ```

5. 提交消息遵循[提交约定](#提交约定)。
6. 推送前如需发布动作，先与维护者确认；PR 默认只做代码与测试，不自行发布。

## 如何参与 Good First Issue

- 在 [Issues](https://github.com/Dylan5237/kcc-workbench/issues) 中查找带 `good first issue` 标签的任务。
- 每个任务都标注了背景、修改边界、入口文件、验收标准与难度。
- 参与前先在该 Issue 下留言认领，避免多人重复改同一文件。
- 提交 PR 时在描述中引用对应 Issue 编号。

## 隐私与安全

- 本项目不提供遥测、广告或远程分析。
- 时间机器等本地快照可能包含项目文件内容，请勿在不信任的设备上保留敏感快照。
- 发现漏洞请走 [SECURITY.md](./SECURITY.md) 的私密报告通道。
- 发布前请阅读 [PRIVACY.md](./PRIVACY.md) 与 [SECURITY.md](./SECURITY.md)。
