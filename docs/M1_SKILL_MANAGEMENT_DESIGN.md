# M1 详细设计 · Skills 全局管理（能力资产库）

> 状态：设计定稿（MVP 原型已确认）
> 关联：`docs/WORKBENCH_SETTINGS_DESIGN.md` 第 4 节（Skill 混合投影）、`docs/assets/prototype-skill-global-m1.html`
> 范围：M1 MVP（按 v2 原型）+ 后续接入大模型的入口预留

## 0. 不可约结果

用户维护一份能力资产（skill），在 Kimi Code / Claude Code / Codex 想用的引擎会话中都能加载。

- 主用户：KCC Workbench 使用者（在本机、多引擎间切换）。
- 触发：在设置页添加/移除/切换 skill 的引擎可用性。
- 成功终态：页面出现"已同步 Kimi / Claude / Codex"，Kimi 实时、Claude/Codex 新会话生效。
- 事实源：`<exe>/config/skills/`（便携、随 exe 迁移；不可写时回退 userData）。
- 权威边界：Workbench 只管理自己创建的投影项，绝不误删用户手工放置的 skill。

## 1. 术语与范围

- **能力资产库 / SSOT**：全局 skills 目录，唯一事实源。
- **投影**：把库内 skill 按引擎的发现机制，同步/指向到各引擎能力目录。
- **管理项**：库内一个 skill 及其启用矩阵（kimi/claude/codex）。
- **历史/未管理**：各引擎目录里用户手工放置（非 Workbench 创建）的 skill，只读展示不操作。

## 2. 功能范围（MVP）

MVP 有：

1. 能力资产库：添加本地 skill 目录（含 `SKILL.md`）到全局库；默认三引擎启用。
2. 每 skill 引擎启用矩阵：行内摘要 + 展开细调；至少保留一个引擎启用（护城河）。
3. 投影服务：Kimi 用原生 `extra_skill_dirs` 指针（实时）；Claude/Codex 自动选择软链优先、失败回退复制；只管理自建项。
4. 同步状态可观察：保存后结果条显示各引擎已同步数量；失败则指出引擎与下一步。
5. 移除先备份、可撤销：移除 = 停用 + 备份到 `<exe>/config/skill-backups/` + 删除，页面可一键恢复。
6. 高级与诊断（折叠）：展示三引擎落点目录、投影方式、当前加载数、最近错误。
7. **AI 摘要入口（预留）**：UI 上为每个 skill 预留"AI 自动总结用途"入口位（占位说明：M3 接入大模型后启用），本期不调用任何模型。

MVP 明确不做（延后到 M3+）：

- 仓库安装/发现（GitHub zip / skills.sh / 多仓库）。
- 云同步（WebDAV/S3）。
- skill 更新检测与回滚。
- junction 硬链接可选项（可作为高级隐藏项，默认关）。
- 自动"AI 总结"的实际模型调用（只留入口）。

## 3. 事实源与数据模型

SSOT 目录结构：

```
<exe>/config/skills/
  <skill-dir>/SKILL.md   ...
<exe>/config/workbench-config.json
<exe>/config/skill-backups/
  <skill-name>-<ts>/
```

全局配置 `workbench-config.json` 新增：

```jsonc
{
  "skills": {
    "library": "<exe>/config/skills/",          // 事实源目录（可被工程覆盖）
    "managed": {
      "<skillName>": { "apps": { "kimi": true, "claude": true, "codex": true } }
    },
    "projection": { "claude": "auto", "codex": "auto" }  // auto|symlink|copy；Kimi 用指针
  }
}
```

- `managed` 记录每个库内 skill 的启用矩阵；**库内目录是事实源，配置只存启停与投影策略**。
- 兼容保留：Kimi `config.toml` 的 `extra_skill_dirs` 仍为指针来源，M1 界面写入的指针与该字段双向一致。

## 4. 投影设计

### 4.1 引擎发现机制与投影动作

| 引擎 | 发现机制 | 投影动作 | 生效时点 |
|---|---|---|---|
| Kimi Code | `extra_skill_dirs` 指针 | 写入 `~/.kimi-code/config.toml` 指向全局库 | 实时（app 内存配置 + 重启后仍生效） |
| Claude Code | `~/.claude/skills/` 目录 | 软链优先，失败复制；仅对启用项操作 | 新会话 |
| Codex | `~/.agents/skills/` 目录 | 软链优先，失败复制；仅对启用项操作 | 新会话 |

### 4.2 自动策略

- `auto`：目标存在且不是自建链接 → 保持（绝不覆盖用户内容）；目标为自建链接 → 重建；创建链接失败 → 回退复制到临时目录再原子 rename。
- `copy`：整目录复制到临时目录，`fs.rename` 原子替换；失败保留旧副本。
- 清理：仅删除"指向 SSOT 的软链"或"有同名全局管理项且已停用"的目标；对其他目标目录内容一律不动。

### 4.3 安全红线

- 添加/覆盖前校验源目录存在 `SKILL.md`，缺失拒绝。
- 同一 skill 若目标目录已有同名真实目录（非自建），**不覆盖**，诊断中标记"冲突"。
- 移除：先备份整目录到 `skill-backups/`，再从各引擎投影目录删除；备份可恢复。
- 所有目标操作均限定在 `~/.claude/skills`、`~/.agents/skills` 及显式 SSOT 内，不做任何递归删除扩展。

## 5. 与大模型接入口（预留，不实现）

- UI：每个 skill 卡片提供"AI 摘要"按钮位（本期为禁用/说明占位）。
- 数据层：`skills` 配置预留 `summary` 字段（`string | null`），本期不写入。
- 未来接入点：设置页保存后把 `{description, source, manifestText}` 传给可配置的摘要服务，回填 `manifest.summary`；服务抽象为 `src/main/skills-summary-provider.js`（本期仅接口占位，不建文件避免死代码，若需可后续加）。
- 验收：M1 不调用模型，不引入依赖；入口点击提示"将在接入大模型后可用"。

## 6. 状态与反馈

- 每个 skill 三种引擎状态：启用/停用；行内摘要 + 展开开关。
- 保存结果条：成功`已同步 Kimi x / Claude y / Codex z`；失败红条指明引擎与恢复动作。
- 诊断表：引擎/方式/目录/当前加载/状态，冲突与错误高亮。

## 7. 关键时序（正常与失败）

正常保存：收集 UI 变更 → 校验 → 更新 SSOT 与配置 → 投影（Kimi 指针、Claude/Codex 同步）→ 返回汇总。

高风险失败：目标目录存在同名真实目录（用户手工 skill）→ 不覆盖、诊断标记冲突、结果条提示；移除后备份失败 → 中止移除并提示。

## 8. 测试与验收

- 单元：`skills-service.test.js` 覆盖——添加复制、启用矩阵、至少一个引擎、自动软链失败回退复制、只清理自建项、备份/恢复、冲突不覆盖。
- 类型：`vue-tsc` 仅在涉及 typed 文件时；本项目 renderer 用原生 JS，主要靠 `node --test` + `npm run build`（含类型检查）。
- 交互验收（用户）：打开设置页 Skills 面板，添加本地 skill 后三引擎默认启用；关某引擎后摘要联动；保存后 Kimi 实时、Claude/Codex 新会话生效；移除后备份且可撤销；AI 摘要入口为占位。

## 9. 边界与回退

- exe 目录不可写：SSOT/备份自动回退 userData，UI 显示"配置存储位置"。
- 引擎目录不可写/权限不足：该引擎标记"同步失败"，不影响其他引擎，且不阻塞保存。
- 跨盘/网络盘符号链接受限：自动回退复制，不报错阻断。
- 升级覆盖：配置放 `<exe>/config/`，升级包不触碰。

## 10. 决策台账

| ID | 决策 | 状态 | 答案 |
|---|---|---|---|
| D-01 | 核心心智 | confirmed | 能力资产库，非引擎同步中心 |
| D-02 | 每行引擎控制 | confirmed | 默认全开 + 摘要 + 展开细调 |
| D-03 | 同步方式可见性 | confirmed | 全自动，诊断折叠 |
| D-04 | 移除语义 | confirmed | 先备份、可撤销 |
| D-05 | AI 摘要入口 | confirmed | 预留占位，M3 接入，本期不调用 |
| D-06 | 高级项（junction/仓库/云同步） | deferred | M3+ |

## 11. 里程碑落地计划

- 后端：新增 `src/main/skills-service.js`（库/投影/备份/同步/冲突/诊断）；`settings-service.js` 保留 Kimi 兼容并接入新库。
- IPC/preload：增加 `settings:skills-list` / `settings:skills-save`（或并入 `settings:save`）与 renderer 绑定。
- UI：替换 `Skills 与 Agent` 面板为 v2 能力资产库；`extra_skill_dirs` 编辑收敛为"指针状态"只读/维护。
- 提交：按功能边界拆分（后端/配置/UI/测试…），遵循 Conventional Commits，作者 Dylan5237。
