import { useRef, useCallback } from 'react'

/** Tracks async load generations so stale responses never leave loading stuck (StrictMode-safe). */
export function useLoadGuard() {
  const seqRef = useRef(0)

  const begin = useCallback(() => {
    seqRef.current += 1
    return seqRef.current
  }, [])

  const isCurrent = useCallback((seq) => seqRef.current === seq, [])

  return { begin, isCurrent }
}
