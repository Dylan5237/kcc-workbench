export function createBackgroundContextSync({
  sync,
  onError = () => {},
  debounceMs = 250,
  pollMs = 3000,
  timers = globalThis
}) {
  let active = false
  let running = false
  let queued = false
  let debounceTimer = null
  let pollTimer = null

  const run = async () => {
    debounceTimer = null
    if (!active) return
    if (running) {
      queued = true
      return
    }
    running = true
    try {
      await sync()
    } catch (error) {
      onError(error)
    } finally {
      running = false
      if (queued && active) {
        queued = false
        request(0)
      }
    }
  }

  const request = (delay = debounceMs) => {
    if (!active) return
    if (debounceTimer) timers.clearTimeout(debounceTimer)
    debounceTimer = timers.setTimeout(run, delay)
    debounceTimer?.unref?.()
  }

  const start = () => {
    if (active) return
    active = true
    request(0)
    pollTimer = timers.setInterval(() => request(0), pollMs)
    pollTimer?.unref?.()
  }

  const stop = () => {
    active = false
    queued = false
    if (debounceTimer) timers.clearTimeout(debounceTimer)
    if (pollTimer) timers.clearInterval(pollTimer)
    debounceTimer = null
    pollTimer = null
  }

  return { start, stop, request }
}
