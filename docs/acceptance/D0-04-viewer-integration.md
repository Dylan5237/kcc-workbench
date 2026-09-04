# D0-04 — KCC Viewer 作为 Arckeep 第一方审查面：复用与集成证据

WorkPackage: D0-04（GitHub Issue `#7`）
Role: Global / Runtime Engineer（KimiCode）
Baseline: `014ab506dcfb6f9efe2154278cec4916cfc2f743`
Branch: `feat/d0-04-viewer` → PR target `integration/arckeep-daily-driver`
Worktree: `D:\_projects\tools\kcc-workbench-wt-d0-04`（本报告所有证据均在该 worktree 内产生）

## 0. 结论

**复用成立（Reuse Gate 通过，走 option 1+2）**：现有 `src/viewer/server.cjs` 是纯 Node core HTTP 模块，不依赖 Electron。未重写任何 Viewer 层；只新增了一个进程入口 seam（`standalone.cjs`）和一个 C# sidecar 桥（`ViewerService.cs`），并把真实 Viewer 页面装入 Arckeep 的 WebView2。

`server.cjs` / `diff.cjs` / `time-machine.cjs` / `public/**` **零改动**。

## 1. 选定的复用 seam

```
Arckeep Shell (C#/WinForms)
  └─ ViewerService.cs                    新增：sidecar 生命周期 + 项目根同步
       └─ node src/viewer/standalone.cjs 新增：进程入口（仅此一个 Viewer 侧新文件）
            └─ src/viewer/server.cjs     原样复用（startServer 导出，Electron 主进程同款）
                 └─ src/viewer/public/** 原样复用 → WebView2 加载（ShellWindow._viewerView）
```

新增的两条进程 seam，均不改 Viewer 内部行为：

- **stdout 握手**：sidecar 就绪后打印一行 JSON `{type:"ready", port, token, root}`。端口随机（`port:0`，沿用既有 `RESTRICTED_BROWSER_PORTS` 规避逻辑），token 每进程随机 32 字节，只经此握手行传递。
- **stdin 控制通道**（JSON 行，id 关联应答）：`set-root`（项目根同步）、`ping`、`shutdown`。宿主关闭 stdin（进程被杀/退出）时 sidecar 自动退出，不留孤儿进程。

## 2. 服务生命周期（V1 + V5）

- **入口**：`node src/viewer/standalone.cjs --config-dir <dir> --root <projectDir> [--port N]`。缺 `--config-dir` 退出码 2。
- **config 所有权**：`%APPDATA%\Arckeep\viewer\`（`viewer-config.json` + `time-machine/`），与 KCC v1 的 Electron `userData` 隔离，互不污染。
- **启动时机**：惰性——首次打开 Viewer 时按当前 Arckeep 项目根启动；项目切换时若 sidecar 在运行则经 `set-root` 热同步，未运行则下次打开按新项目启动。
- **关闭**：壳 `FormClosed` → `ViewerService.Dispose()` → 先发 `shutdown` 控制命令（优雅关闭 watcher/time-machine/HTTP），1.5s 未退出则 `taskkill /T /F`（与 `KimiWebService` 同款兜底）。
- **故障隔离（V5）**：Viewer 是独立 Node 进程 + 独立 WebView2（独立 UDF），与 Kimi Web 进程、ACP 进程、Arckeep UI 无任何共享状态。sidecar 崩溃：stdout 泵使挂起请求快速失败；UI 仅在 Viewer 面板内显示错误页；再次打开即全新重启。

## 3. 证据

### V1 — Standalone Viewer（脱离 Electron 独立启动）

自动化测试 `test/viewer-standalone.test.js`（spawn 真实子进程，非内存调用）：

- 握手行携带 `port/token/root`，token 为 64 位 hex；`root` 等于传入项目目录。
- 无 cookie 访问 `/api/tree` → **401**；`GET /?token=...` → **302** 并种 `kimi_viewer` HttpOnly SameSite=Strict cookie；伪造 Host 头 → **403**（host 绑定检查）。
- 手动复验（curl，端口随机）：tree/md/json/html-preview/index 全部 200，CSP 头在位。

### V2 — WebView2 真实加载

钩子：`ARCKEEP_TEST_VIEWER=1 ARCKEEP_TEST_VIEWER_PROJECT=<dir> ARCKEEP_TEST_VIEWER_OUT=<proof.json>`，exit 0 = 通过。真实运行结果（proof JSON）：

```json
{"href":"http://127.0.0.1:8307/","title":"文件查看器与任务时间机",
 "root":"C:\\Users\\howyo\\AppData\\Local\\Temp\\tmp.kLmkNYfPkM\\proj",
 "treeChildren":3}
```

页面在 WebView2 内完成 token bootstrap → 302 → cookie → `/api/tree` 200（cookie 鉴权生效）。`title` 为真实 Viewer 前端标题。

### V3 — 项目根确定性同步

- 双向证据：`set-root` 经 stdin 通道后，`/api/root` 与 `/api/tree` 立即反映新根（测试断言 `response.ok === true` 且 `rootState.root === root2`）。
- **不扩大文件系统权限**：`set-root` 到不存在目录返回 `ok:false`（测试断言）；路径越权仍由 server 既有 `safeResolve`/`isInsidePath`/`realpath` 防线拦截（403）。
- WebView2 证据中 `root` 字段 == 传入的 Arckeep 项目目录，逐字节一致。
- 壳侧接点：`PickDirectory` / `LoadLastProject` → `SyncViewerRoot()`；`ToggleViewerAsync` → `EnsureStartedAsync(_store.Root)`（根不一致先同步再展示）。

### V4 — 真实能力（自动化测试断言 + curl 复验）

- **文件树**：fixture 项目（docs/note.md、data.json、page.html）全部出现在 `/api/tree`。
- **Markdown**：`/api/file?p=docs/note.md` 返回完整内容与 `kind:"doc"`；前端渲染走既有 marked/DOMPurify 管线（未改）。
- **JSON**：`/api/file?p=data.json` 内容 round-trip `JSON.parse` 相等。
- **Diff/review**：修改被监听文件后，`/api/artifacts` 报告 `type:"modified"` 且 `diff` 含 `{type:"add", text:"- changed line..."}`（真实 watcher + `createLineDiff` 路径）。
- **HTML preview**：`/api/html-preview?p=page.html` 200，正文含 `<h1>preview</h1>`，CSP `script-src 'none'` 等既有安全策略原样生效。

### V5 — 故障隔离

钩子 `ARCKEEP_TEST_VIEWER_KILL=1`：Viewer 加载成功后**强杀 sidecar 进程**，再关闭并重开 Viewer。真实运行结果：

```json
{"first":{"href":"http://127.0.0.1:3290/","treeChildren":3,...},
 "afterKill":{"href":"http://127.0.0.1:7239/","treeChildren":3},
 "uiAlive":"alive"}
```

sidecar 被杀后：壳进程存活、主 UI WebView2 探活 `alive`、Viewer 以新端口重启并重新加载同一项目树。Kimi/ACP 工作面与 Viewer 无共享进程或状态（结构性隔离）；既有 `StartSessionAsync` 路径未改动。

## 4. Auth / 安全边界

- token 每进程随机生成，仅存内存，经 stdout 握手行传递一次，不落盘、不进日志（`Program.Log` 只记端口与根路径）。
- WebView2 导航 `http://127.0.0.1:<port>/?token=<token>` → 302 种 `HttpOnly; SameSite=Strict` cookie → 后续 `/api/*` 凭 cookie；token 不出现在地址栏之外的地方。
- 仅绑定 `127.0.0.1`；Host 头必须精确匹配 `127.0.0.1:<port>`（防 DNS rebinding）；静态服务限制在 `public/` 内；文件读取限制在已声明根内（`realpath` 双向校验）。
- stdin 控制通道不暴露网络面：不能接受网络请求改根，只有持有子进程 stdin 的宿主壳能同步根目录。

## 5. 回归与构建

- `npm test`（worktree 内，`npm ci` 后）：**124/124 通过**（含新增 `viewer-standalone.test.js` 2 个用例；既有 viewer-server/diff/time-machine/context-sync/tree-state 全部原样通过）。
- `dotnet build -c Release`（arckeep/shell）：**0 错误**（1 个既有警告）。
- 两次真实 Arckeep.exe 钩子运行：V2 exit 0；V5 kill 模式 exit 0。

## 6. Changed files

新增：
- `src/viewer/standalone.cjs` — Viewer 独立进程入口 + stdin 控制通道
- `arckeep/shell/ViewerService.cs` — C# sidecar 桥（启动/握手/根同步/关闭/崩溃清理）
- `test/viewer-standalone.test.js` — V1/V3/V4 自动化证据
- `docs/acceptance/D0-04-viewer-integration.md` — 本报告

修改（均为窄接入，无 Viewer 内部行为变更）：
- `arckeep/shell/ShellWindow.cs` — `_viewerView` WebView2、标题栏 Viewer 切换按钮、项目根同步接点、`open-viewer` 桥消息、`ARCKEEP_TEST_VIEWER[_KILL]` 验证钩子
- `arckeep/ui/index.html` / `arckeep/ui/app.js` — 项目空间「Viewer 检查」入口按钮
- `arckeep/README.md` — 结构/验证钩子/踩坑/已知边界更新
- `AGENTS.md` — 前置条件补充 Node.js（Viewer sidecar）

## 7. Time Machine 状态

**保留且运行中，UI 集成未做任何删除/重写。**

- `time-machine.cjs` 未改动；sidecar 模式下 `createTimeMachine` 照常启动，`/api/time-machine`、`/api/time-machine/checkpoint`、`forkCheckpoint` 全部可用，存储落在 `%APPDATA%\Arckeep\viewer\time-machine\`。
- Viewer 前端自带的 Time Machine 界面随 `public/**` 原样装入 WebView2，无额外工作。
- 未做的新工作：把 Arckeep 项目/会话上下文映射为 Time Machine 会话标签（`setConversationContext` 的 label/id 语义接入）。**后续接回 seam**：`standalone.cjs` stdin 通道加一条 `set-context` 命令（调 `server.setConversationContext`），或在 `ViewerService` 同步根时附带会话标签。属于增量增强，不是修复。

## 8. 限制（limitations）

- 运行时需要 **Node.js 在 PATH 中**（sidecar 以系统 Node 运行）。生产零依赖需随 Arckeep 打包 Node 运行时 + `marked/mermaid/dompurify` 依赖，本 WorkPackage 未做打包（与 KCC v1 CloudCLI 的已知限制同类）。
- Viewer sidecar 入口路径按仓库布局解析（`bin/Release/net7.0-windows` 上溯 5 级，或 CWD=仓库根）；脱离仓库布局的独立安装包尚未覆盖。
- 视觉/版式未做任何调整（遵守 DESIGN RESET：先接真实面，视觉收敛由 User + ChatGPT 依据真实截图驱动）。
- Coding Agent 未做截图视觉验收；`ARCKEEP_SHOT` 系列钩子可在真实机器上补截图。
- Viewer 面板在接入态（Kimi Web 并排）下打开会整幅覆盖工作面，但只是可见性切换——agent/UI webview 均保持运行，关闭 Viewer 即恢复原布局。
