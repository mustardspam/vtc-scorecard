// Errors flagged permanent (bad credentials, validation, a 4xx) are never retried.
const PERMANENT = /login|password|credential|unauthori[sz]ed|forbidden|rejected the key|mfa|captcha|admin/i

export function permanent(message) {
  const err = new Error(message)
  err.permanent = true
  return err
}

export function isTransient(err) {
  if (err?.permanent) return false
  return !PERMANENT.test(err?.message || '')
}

export const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Runs fn up to `attempts` times, backing off baseDelayMs x 1, 2, 4... between tries. */
export async function withRetry(fn, { attempts = 3, baseDelayMs = 30000, label = '', log, wait = sleep } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      if (attempt >= attempts || !isTransient(err)) throw err
      const delay = baseDelayMs * 2 ** (attempt - 1)
      log?.warn('retrying', { what: label, attempt, of: attempts, inSeconds: Math.round(delay / 1000), error: err.message })
      await wait(delay)
    }
  }
}
