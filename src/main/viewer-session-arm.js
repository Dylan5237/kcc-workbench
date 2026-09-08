// Serializes Viewer conversation-context synchronization behind one promise
// queue and enforces the session-arm lifecycle:
//  - every sync (background poll, navigation signal, tab/engine switch) shares
//    this queue, so detections never overlap;
//  - sync requests pile up while one run is already queued collapse into that
//    single queued run (each run re-observes current state, so N queued runs
//    would all do the same work);
//  - a detection whose observed engine/URL changed while it ran is discarded
//    as stale — an async detection result can never overwrite a newer session —
//    and reported so the caller can re-request immediately;
//  - a detection miss keeps the currently armed context untouched (Viewer
//    recording is never disarmed by a missing signal).
export function createViewerSessionArm({ observe, detect, apply, onEvent = () => {} }) {
  if (typeof observe !== 'function' || typeof detect !== 'function' || typeof apply !== 'function') {
    throw new Error('viewer session arm requires observe/detect/apply functions')
  }
  let tail = Promise.resolve()
  let queued = null // 已入队未开始的那一次；期间的 sync 请求共享它

  async function execute() {
    try {
      const before = await observe()
      const detection = await detect(before)
      const after = await observe()
      if (before?.key !== after?.key) {
        await onEvent('context-stale', {
          engine: before?.engine,
          beforeUrl: before?.url,
          afterUrl: after?.url
        })
        return { applied: false, stale: true }
      }
      const context = detection?.context
      if (!context?.projectDirectory) {
        await onEvent('context-miss', { ...(detection?.diagnostics || {}) })
        return { applied: false }
      }
      await apply(context, detection)
      return { applied: true }
    } catch (error) {
      await onEvent('context-error', { message: String(error?.message || error) })
      return { applied: false, error: true }
    }
  }

  function sync() {
    if (queued) return queued
    const start = () => {
      queued = null
      return execute()
    }
    const run = tail.then(start, start)
    queued = run
    tail = run.then(() => {}, () => {})
    return run
  }

  return { sync }
}
