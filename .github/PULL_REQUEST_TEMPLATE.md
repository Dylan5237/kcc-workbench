## 概述

请用一句话说明这个改动解决了什么。

## 关联 Issue

Closes #（填写 Issue 编号）

## 改动范围

- 修改/新增/删除的文件：
- 涉及引擎：Kimi Code / CloudCLI / Viewer / 其他

## Runtime Architecture Declaration

规范：`docs/architecture/ARCHITECTURE_REVIEW_GATE.md`

- 架构审核适用性：runtime-sensitive / mixed / N/A
- 如为 N/A，请说明原因：

### Execution Topology

对本 PR 新增或实质修改的非平凡运行时任务逐项填写；无则写 `N/A`。

| 任务/组件 | Process | Thread / Event Loop | Trigger | Owner / Lifetime | Cancellation / Failure Isolation |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

### Runtime Budget

后台、轮询、扫描、索引、网络、队列、Worker/子进程等资源敏感路径逐项填写相关预算；不适用项写 `N/A`。

| 任务 | Deadline / Time Slice | Max Entries / Bytes / Memory | Concurrency / Queue | Timeout / Retry | Cancel / Context-change Policy |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

### Runtime Safety Checklist

- [ ] 未在 Electron main / 交互关键 renderer 路径新增无界同步 I/O 或重 CPU 工作；不适用时已说明
- [ ] 周期/后台任务有明确边界，且不会无控制重叠、堆积或无限增长
- [ ] Worker / 子进程 / watcher / timer / queue 的启动、ownership、退出和异常清理明确
- [ ] session/project/context 切换时，在途任务可取消或有 stale-result 防护
- [ ] 大 workspace、慢网络、hung child 等异常负载只降级相关子系统，不冻结整个 shell
- [ ] IPC / HTTP / SSE 等边界保持最小权限、输入校验和既有认证约束
- [ ] 日志/诊断不泄漏 token、cookie、secret 或不必要的私有内容

## 验证

- [ ] `npm test` 通过
- [ ] 影响打包或运行时行为时 `npm run build` 通过
- [ ] 性能敏感改动已提供与风险相匹配的 benchmark / timing / 大 workspace / 实机证据，或说明为何不适用
- [ ] 未改回 portable exe 或 `asarUnpack: node_modules/**`
- [ ] 未包含无关重构、格式化或行尾清理

## 已知限制

如有遗留问题或后续事项，请在此说明。
