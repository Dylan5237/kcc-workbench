# Workbench 通用设置与全局资源管理 · 全量设计

> 状态：设计定稿（Memory 域标待议）
> 阶段：设计探讨完成，待用户确认后进入实现
> 关联：feature/viewer-modes（同属 v1.1 迭代）

## 1. 背景与问题

现有设置页存在三个问题，且三个问题的根因同源：

1. **只有 Kimi Code 配置可视化，没有 workbench 自己的设置**：设置服务读写的全部是
   `~/.kimi-code/` 下的 `config.toml / tui.toml / mcp.json / SYSTEM.md / AGENTS.md`，
   所有字段都是 Kimi CLI 的字段，workbench 自身的配置项一个都没有。
2. **设置入口被硬编码成 Kimi 专属**：`main.js` 的 `switchTab` 在 `activeEngine !== 'kimi'`
   时直接拒绝进入设置，shell 层也把设置 tab 隐藏。
3. **配置改了不生效**：保存链路里只有 `default_permission_mode` 变化会触发服务重启，
   其余字段写进 `config.toml` 就结束，服务不重启、workbench 也不消费，新会话读到的仍是旧值。

根因不是“配置没保存”，而是缺少**“配置 → 运行时行为”的传导契约**——持久化不等于生效。

## 2. 第一性原理

workbench 这个产品的本质：**一个承载多引擎（Kimi / CloudCLI / Codex）的壳，加上一套共享的
产物体验（Viewer + 时间机器）。**

由此，设置天然分两种本质：

| | 引擎配置（Engine Profile） | Workbench 配置（Product Settings） |
|---|---|---|
| 谁拥有 | 各引擎自己 | workbench 自己 |
| 举例 | kimi 的 config.toml、cloudcli 的配置 | 默认引擎、Viewer 模式、引擎路径定位 |
| workbench 角色 | 定位 / 透传 / 诊断，不重写格式 | 定义、持久化、**保证生效** |

现有设置页把“引擎配置”当成了“workbench 设置”的全部，而 workbench 层整个缺失。

## 3. 四层架构

```
┌─────────────────────────────────────────────┐
│  L1 产品层   Workbench 全局配置              │
│  默认引擎 / Viewer 模式 / 行为偏好            │
│  存 exe 所在路径，workbench 自己拥有          │
├─────────────────────────────────────────────┤
│  L2 共享资源层  Skill / MCP / Memory         │
│  单一事实源，三个引擎共用                    │
├─────────────────────────────────────────────┤
│  L3 投影层   projection engine               │
│  把 L2 渲染到各引擎的目录 / 配置文件          │
├─────────────────────────────────────────────┤
│  L4 引擎原生层  各引擎自己的配置              │
│  config.toml / settings.json / mcp.json      │
│  只读诊断 + 关键项透传，不重写其格式          │
└─────────────────────────────────────────────┘
```

### 3.1 L1 产品层

workbench 自己的全局配置，候选配置项：

- 会话：默认引擎（Kimi / CloudCLI / Codex）、启动时是否记住上次引擎。
- Viewer：默认模式（auto / dev / run）、默认根目录、是否自动跟随会话路径透传。
- 引擎定位：CloudCLI / Codex / Node 22 的可执行路径。
- 行为：额度弹窗默认展开、日志级别。

**存储位置：exe 所在路径**（便携、绿色、随 exe 迁移）。配置放独立子目录
`<exe>/config/`，升级约定不触碰该目录。

### 3.2 L4 引擎原生层

每个引擎一个 tab：Kimi 沿用现有 TOML 可视化；CloudCLI / Codex 各自给到
“配置路径定位 + 只读诊断 + 关键项透传”，不重写其原生格式。

## 4. Skill 全局统一（混合投影）

### 4.1 事实：三个引擎对“额外 skill 目录”支持差异大

- **Kimi Code**：原生支持 `extra_skill_dirs`，绝对路径、追加而非替换。
- **Claude Code**：`settings.json` 无等价字段；官方路径是复制/软链到
  `~/.claude/skills/`，或打成 plugin，或项目内 `.claude/skills/`。
- **Codex**：`config.toml` 无任意额外目录设置；`[[skills.config]]` 是逐 skill 的
  `path + enabled`，用户级目录 `~/.agents/skills/`（新版）。

结论：没有“纯配置指针”能三引擎通吃，统一层本质是“在三种发现机制上叠一个统一层”。

### 4.2 五种投影方式与利弊

| 方式 | 利 | 弊 |
|---|---|---|
| ① 目录 junction | 单一事实源、零同步延迟、改一处三处即时生效 | 平台级行为，跨盘/杀软/云盘易出问题；引擎升级覆盖会打断链；调试难 |
| ② 目录复制同步 | 引擎无感知、最稳、任何引擎都接受 | 三份物理副本；存在时序与冲突；要设计变更检测与方向约定 |
| ③ 配置指针 | 最轻、引擎原生 | 仅 Kimi 支持，无法三引擎统一 |
| ④ 逐 skill 配置 | 精确、可单 skill 开关 | 是枚举不是目录，新增要新增配置；Claude 需打 plugin，维护成本高 |
| ⑤ 启动参数注入 | 不落盘、不动引擎配置、最干净 | 只对 workbench 启动的会话生效；脱离 workbench 开 CLI 就失效 |

### 4.3 判定方法

按顺序回答三问：

1. skill 是否只在 workbench 启动的会话才需要生效？否（用户可能直接开 CLI）→ 排除⑤。
2. 部署形态是否允许目录 junction？便携 exe、单机、不跨盘可考虑①；跨盘/多机则不可靠。
3. 能否接受“多副本 + 同步”复杂度？能 → ②；不能 → 混合。

### 4.4 结论：混合模式

- **主路径 = ② 复制同步**：全局 `<exe>/config/skills/` 为唯一事实源，保存时同步到
  `~/.kimi-code/skills`、`~/.claude/skills`、`~/.agents/skills`。
- **Kimi 加分项 = ③ 指针**：Kimi 原生 `extra_skill_dirs` 直接指全局目录，省一次复制、天然实时。
- **① junction 作为可选增强，默认关**：高级用户可开“硬链接模式”，明确标注风险。
- **④ 只做“单 skill 启停/覆盖”层，不做发现层**。

## 5. MCP 全局统一（标准定义 + 生成）

- 全局存一份**标准 MCP server 定义**（name + command/url + env + enabledTools + disabledTools）。
- 投影层按引擎格式生成/合并：kimi 的 `mcp.json`、Claude 的 `.mcp.json`、
  Codex `config.toml` 的 mcp 段。
- 敏感项（API key）不进全局明文，或明确标注“仅本地、不上传”。

## 6. Memory 全局统一（待议，不设计、不执行）

Memory 域坑很多，本版**明确标记为待议**：不设计、不执行、不排期。后续单独研究后再决定。

## 7. 配置生效契约（针对“改了不生效”）

每个配置项声明**生效时机（scope）**，由 workbench 主动执行传导：

- `immediate`：改完立即生效（UI 偏好，如 Viewer 模式、弹窗默认）。
- `next-session`：下次启动引擎会话生效（如权限模式、模型），保存后 workbench 主动重启对应服务并提示。
- `restart-workbench`：重启应用生效（如引擎路径、Node 路径），明确标注。

保存按钮旁显示“生效方式”；凡需重启的，workbench 替你重启。

## 8. 引擎无关性

设置页不再对 Kimi 隐藏。Workbench 层任何引擎下可进；引擎层 tab 跟随当前引擎高亮，但都可见。

## 9. 边界情况

1. **exe 目录只读**（Program Files 安装）：可写则用 exe 旁配置，不可写则回落到
   `%APPDATA%`，并在设置页明示当前配置实际落点。
2. **多实例 / 多版本隔离**：exe 旁配置意味着“每个 exe 一份配置”，属便携特性，UI 需明示“这是本实例配置”。
3. **升级覆盖风险**：配置放 `<exe>/config/` 子目录，升级不触碰。
4. **引擎侧手改冲突**：同步方向约定为“全局为源，引擎侧改动会被覆盖”，并在 UI 提示。

## 10. 开源项目选型（复用，不重造）

| 域 | 首选 | 复用方式 |
|---|---|---|
| Skill | `anthropics/skills` + `nikships/skills-registry` | 前者是标准源头（沿用 SKILL.md 规范）；后者借鉴“GitHub repo 作事实源 + 安装”模型 |
| MCP | `pathintegral-institute/mcpm.sh` | 跨客户端 MCP 配置管理，可作依赖或借鉴 profile 模型 |
| Memory | 待议 | 不选型，后续单独研究 |

## 11. 迭代规划（卡诺模型 + 第一性原理）

### 11.1 卡诺分类

| 需求 | 卡诺类型 | 说明 |
|---|---|---|
| 配置生效契约 | 基本型 | “改了要生效”是底线，现在做不到，用户已不满 |
| Workbench 配置持久化层 | 基本型 | 没有统一配置层，上层全局管理无从谈起 |
| 设置页引擎无关化 | 期望型 | 越开放越符合 workbench 定位，缺了不至于崩溃 |
| Skill 全局统一 | 期望型 | 高频痛点“配三遍”，解决后满意度线性上升 |
| MCP 全局统一 | 期望型 | 同 Skill，痛点同源 |
| Skill junction 加速 | 兴奋型 | 无它也能用（同步已解决），有它是体验惊喜 |
| 开源 registry 接入 | 兴奋型 | 锦上添花 |
| Memory 全局统一 | 待议 | 不分类、不排期 |

### 11.2 第一性原理排序

workbench 核心价值 = “让多引擎 + 共享产物体验用起来更灵活”。灵活的前提是
**配置可信、配置统一**。因此：

- P0 = 可信配置（生效契约 + 统一持久化层）。
- P1 = 高频痛点（Skill 先于 MCP：Skill 是 agent 能力核心，且三引擎支持差异最大、最需要混合投影）。
- P2 = 加速 / 增强（junction、registry）。

### 11.3 迭代里程碑

```
M0（P0 地基）Workbench 配置层 + 生效契约
  - workbench-config.json（exe 路径 + 只读降级）
  - SettingsService 重构、scope 模型
  - 设置页引擎无关入口
  - 验收：改一个 next-session 配置，保存后自动重启并生效

M1（P1 核心）Skill 全局统一（混合投影）
  - 全局 skills 目录 + 复制同步 + Kimi 指针 + 单 skill 启停
  - 验收：新增一个 skill，三引擎都能用；Kimi 即时，Claude/Codex 保存后同步

M2（P1 核心）MCP 全局统一
  - 标准 MCP 定义 + 三引擎生成投影
  - 验收：配一个 MCP server，三引擎都连上

M3（P2 增强）junction 加速 + registry 接入（可选，后置）

Memory：待议，不排期。
```
