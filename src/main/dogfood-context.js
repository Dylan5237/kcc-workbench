// K1-D0 R1 (#34): Dogfood capture 的 project/session provenance 必须来自同一个
// "last successfully applied Viewer context" — viewerServer.root 是 Viewer 的
// 当前绑定状态, 引擎切换后可能仍是旧引擎的 root, 不能作为独立 capture 来源。
// 引擎不匹配或尚无 successful apply 时, 两个字段一起为 null, 绝不半填。
export function selectDogfoodCaptureContext(lastAppliedViewerContext, activeEngine) {
  if (!lastAppliedViewerContext || lastAppliedViewerContext.engine !== activeEngine) {
    return { projectRoot: null, sessionId: null }
  }
  return {
    projectRoot: lastAppliedViewerContext.projectDirectory ?? null,
    sessionId: lastAppliedViewerContext.sessionId ?? null
  }
}
