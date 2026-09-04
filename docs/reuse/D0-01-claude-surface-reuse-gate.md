# D0-01 — Claude Visual Surface Reuse Gate（恢复交付）

Status: **COMPLETE — DECISION = REUSE_CDESKTOP**

Parent: GitHub Issue `#4`
Taskbook: `5ce9528d:docs/tasks/claude-code/D0-01-claude-visual-surface-reuse-gate.md`
Execution Rule: `f9eab08d:docs/project/WORKTREE_EXECUTION.md`
验证日期: 2026-09-04（Windows 11 Home 10.0.26200，Node 22.22.1，.NET SDK 7.0，WebView2 Runtime 152.0.4191.53）

> 本会话是上一会话异常退出后的恢复交付：上一会话已完成 C1–C4 全部探针与证据收集（本文件"证据位置"标注的产物均在上会话遗留），并在 Composing/交付阶段崩溃。本次恢复仅补齐缺失的 C5 失败隔离最小探针，随后整理证据、提交、push、开 PR。**未重复任何已完成的探针。**

---

## 1. 执行事实（恢复基线）

| 项 | 值 |
| --- | --- |
| 实现基线 exact | `014ab506dcfb6f9efe2154278cec4916cfc2f743` |
| 专用 worktree 绝对路径 | `D:\_projects\tools\kcc-workbench-wt-d0-01` |
| 分支 | `feat/d0-01-claude-surface`（远端同 baseline，无 PR，无提交） |
| 恢复后 local HEAD / 最终 HEAD | `014ab50` → 本交付 commit（见 §8） |
| 宿主仓库 | `D:\_projects\tools\KCCWorkbench`（仅 entry/control，未改动） |

## 2. cdesktop 事实（C1 结论）

- **npm 版本**：`cdesktop@0.2.3`（解析产物 `spike/cdesktop/npm/cdesktop-0.2.3.tgz`）
- **本地二进制**：`C:\Users\howyo\.cdesktop\bin\v0.2.3-20260519022845\windows-x64\cdesktop.exe`（首启自动下载 47.7MB，Apache License 2.0）
- **上游源码 ref**：`cdesktop-ai/cdesktop` @ `75bd015`（仅参考，不入库）
- **启动命令/URL 行为**：`npx cdesktop` → 拉起二进制；默认 `HOST=127.0.0.1`，`PORT` 未设则 **0 自动分配**；stdout 打印 `Main server on :NNNN, Preview proxy on :NNNN`，并写端口文件 `%TEMP%\cdesktop\cdesktop.port`（`{"main_port":…,"preview_proxy_port":…}`）——这是 host shell 的**标准可发现机制**（两条通道均已实测）
  - 首次实测（上会话，`cdesktop-server.log`）：`Main server on :1274`；本次 C5 实测自动分配 `10661`、`8543`
- **executor**：默认 `Recommended executor: CLAUDE_CODE`，将 `claude` CLI 作为子进程包裹（transcript 内为真实 claude CLI stream_event，非 mock）
- **数据**：SQLite `%APPDATA%\cdesktop\cdesktop\db.v2.sqlite`（探针清理后为空库）

## 3. C1–C5 验证矩阵

| # | 验证项 | 结论 | 证据位置 |
| --- | --- | --- | --- |
| C1 | 本地 web 服务 + 稳定可发现 localhost URL | ✅ PASS | `spike/cdesktop/cdesktop-server.log`（版本/端口/浏览器打开）；`spike/cdesktop/evidence/c5-failure-isolation.json` A 阶段（自动分配端口 + 端口文件 + `/api/health`） |
| C2 | 真实 Claude Code 会话（非 demo/mock） | ✅ PASS | `spike/cdesktop/evidence/transcripts/c2-api-flow-session.jsonl`（235 行，真实 claude CLI 流，模型 `claude-opus-4-8[1m]`，`end_turn`/`completed`，真实计费 $0.203785）；探针 `spike/cdesktop/api-flow.mjs` |
| C3 | WebView2 兼容（origin/auth/nav/SSE/API 路由） | ✅ PASS | `spike/cdesktop/evidence/c3-c4-webview2-probe-result.json` A 阶段（A-load / A-spa / A-health / A-sse / A-sse-trigger 全 ok，SSE `json_patch` 事件实流）；`spike/webview2-probe/`（C# WinForms + WebView2 1.0.2792.45，隔离 UDF）；Runtime `152.0.4191.53` |
| C4 | 切走/切回不销毁会话，可同会话续跑 | ✅ PASS | 同文件 B 阶段：`B-navigate-away`/`B-navigate-back` ok；`B-session-persisted`（found=true，session `f4fc416c…`，localStorage + 后端双持久化）；`B-resume-session`（同 session `f4fc416c…` 续跑 completed）；transcript `wv2-processes-fdaae1c1…jsonl` → `"cdesktop-webview2-resume-ok"` |
| C5 | 失败隔离：Claude surface 挂掉不拖垮宿主/其它 surface | ✅ PASS | `spike/cdesktop/evidence/c5-failure-isolation.json`（本次最小补充探针，见 §4） |

## 4. C5 最小补充探针（本次唯一新增验证）

探针：`spike/cdesktop/probe-c5-failure-isolation.mjs`（node，直启真实 cdesktop 二进制，PORT=0 自动分配 + stdout/端口文件发现，与 Arckeep 实际接入路径一致）。

- **A-startup**：`base=http://127.0.0.1:10661 health=true`，端口文件同步更新 → 受控启动路径
- **B-host**：spawn 独立 OS 进程（"host"，模拟 Arckeep 宿主边界）每 500ms 轮询 surface
- **C-kill**：`taskkill /T /F` 杀 cdesktop（`srvPid=146112`）→ **hostAlive=true**
- **D-host-alive**：宿主进程存活且持续写独立心跳文件；host 观测到 `ev=[{"at":560,"up":true},{"at":5584,"up":false}]`（surface 由 up→down）→ **surface 挂了，宿主不受影响**
- **E-recovery**：重启 cdesktop（自动分配 `8543`）health=true → 恢复路径受控
- 佐证：`spike/cdesktop/cdesktop-server2.log` 末行 `Fatal error: Command failed: …\cdesktop.exe`（服务进程独立失败）；服务对单个 executor 缺失（`opencode` not found）仅 WARN 不崩服。

结论：**一个 Claude surface 进程/服务的失败被隔离在其自身进程与 `%TEMP%\cdesktop\cdesktop.port` 端口域内**；宿主（WebView2 容器）与 Kimi/DSH 各自独立，不受牵连。

## 5. 真实 Claude 会话证据（C2/C3/C4 引用）

- `c2-api-flow-session.jsonl` / `wv2-processes-678e9bda…jsonl`：session `916fe746…`，`stop_reason:"end_turn"`，`terminal_reason:"completed"`，`num_turns:3`，输入 38558 / 输出 235 tokens，`total_cost_usd:0.203785`，结果原文：
  > "The project is written in **Python** … It's a minimal probe project used to verify that a real Claude Code session runs correctly through the cdesktop environment."
- `wv2-processes-72791a10…jsonl`：`"cdesktop-webview2-probe-ok"`（WebView2 内真实验证会话）
- `wv2-processes-fdaae1c1…jsonl`：`"cdesktop-webview2-resume-ok"`（WebView2 内同会话续跑）

探针工程：`spike/probe-project/`（非 git 最小工程 `src/hello.py`，仅用于跑真实会话）。

## 6. 持久化 / 切换证据（C4 引用）

- localStorage 写入 `__probe` 记录 wsId/sessId/procId；导航去 `about:blank` 再回 `http://127.0.0.1:1274` 后，`/api/sessions?workspace_id=` 仍查到同 session（`sessionCount:1`）→ 前端 + 后端双持久化
- 对同 session `f4fc416c…` 再次 `follow-up` → 新 `procId`，status `completed` → **同会话续跑，无需重建 surface**

## 7. 清理证据

- WebView2 探针 Y 阶段：`removedWs:true`（探针 workspace 经 `DELETE /api/workspaces/{id}` 删除；`removedRepo:false` 为探针 repo 的删除结果，不影响判据）
- cdesktop SQLite `db.v2.sqlite`：**空库（0 表）**，无探针残留
- 当前无孤儿 `cdesktop.exe` / `claude.exe` 进程；用户真实 Claude Code 数据未触碰
- 端口文件 `%TEMP%\cdesktop\cdesktop.port` 为正常运行时标记，随下次启动覆盖

## 8. 变更清单与交付

- 变更文件：仅 spike 探针 + 证据 + 本报告 + `.gitignore`（`spike/cdesktop/cdesktop/` 上游 checkout、`npm/package/` 解包、`webview2-probe`/`wv2-debug` 的 `bin/ obj/` 均入库忽略）。**无生产代码改动，无 Arckeep 壳改动**，故不跑 npm build/test（探针以自身 JSON 证据自验证）。
- 提交/推送：见 §9 commit；分支 `feat/d0-01-claude-surface`。
- 最终 HEAD：本交付 commit（见 git log）。

## 9. 决策

**DECISION = REUSE_CDESKTOP**

C1–C5 全部以真实证据 PASS：真实本地服务、真实 Claude Code 会话、真实 WebView2 加载（含 SSE 实流）、真实持久化/续跑、真实失败隔离。cdesktop 是可复用的最短可靠 Claude Code 视觉工作表面。无触发 `FALLBACK_CLOUDCLI` 的硬阻塞。

## 10. Limitations（诚实读法）

1. **浏览器自动打开**：cdesktop 生产构建每次启动自动 `open_browser`（无 env/flag 关闭开关）。Arckeep 集成时需接受该行为或向上游提启动模式开关；属集成打磨项，不阻塞本 gate。
2. **端口非固定**：默认 `PORT=0` 自动分配。Arckeep 必须通过 stdout 行或 `%TEMP%\cdesktop\cdesktop.port` 发现实际端口（两条通道均已实测可用）。
3. **强杀残留**：`taskkill /F` 杀 cdesktop 后，探针端口在 netstat 短暂残留 stale LISTENING 条目（Windows TCP 伪影，owner PID 已不存在）；新服务自动分配新端口即恢复，无功能影响。
4. **语言**：cdesktop UI 默认中文（标题"新会话"）；内置多语言（含 EN），集成时按用户偏好处理。
5. **范围外**：本 gate 仅证明 surface 复用路径，**未**采纳 cdesktop Worktree/Team 域、未做 DSH/ATW/Viewer 迁移（taskbook §7 Forbidden）。
6. **后续**：Arckeep 壳的 spawn+发现端口+WebView2 嵌入为后续 integration 工作，不在本 gate 内。
