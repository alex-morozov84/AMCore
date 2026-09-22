'use client'

import { useEffect, useState } from 'react'

/**
 * Returns `value`, updated only after it has stopped changing for `delayMs`.
 * Generic, zero domain/routing coupling — the console's debounced search
 * (`@/features/console-discovery`) is one consumer, not the only intended
 * one, which is why this lives here rather than inside that feature slice.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
