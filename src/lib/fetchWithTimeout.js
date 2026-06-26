const DEFAULT_TIMEOUT_MS = 25000

export function fetchWithTimeout(input, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  if (init.signal) {
    if (init.signal.aborted) controller.abort()
    else init.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  return fetch(input, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer))
    .catch(err => {
      if (err?.name === 'AbortError') {
        throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`)
      }
      throw err
    })
}
