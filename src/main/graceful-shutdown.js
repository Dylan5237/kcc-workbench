export function createGracefulShutdownHandler({ quit, shutdown, onError = console.error }) {
  if (typeof quit !== 'function' || typeof shutdown !== 'function') {
    throw new TypeError('quit and shutdown must be functions')
  }

  let allowQuit = false
  let shutdownPromise = null

  return function handleBeforeQuit(event) {
    if (allowQuit) return shutdownPromise
    event?.preventDefault?.()
    if (shutdownPromise) return shutdownPromise

    shutdownPromise = Promise.resolve()
      .then(shutdown)
      .catch(error => onError(error))
      .finally(() => {
        allowQuit = true
        quit()
      })
    return shutdownPromise
  }
}
