'use client'

import { useEffect, useState } from 'react'

/**
 * Server time that keeps moving while the page stays open: the offset between the server's read
 * time and this browser's clock is fixed when the data arrives, so a wrong local clock does not
 * change how old an observation looks.
 */
export function useServerNow(readAt: string | null, tickMs = 30_000): number {
  const [tick, setTick] = useState(0)
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    if (readAt) setOffset(Date.parse(readAt) - Date.now())
  }, [readAt])
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), tickMs)
    return () => clearInterval(timer)
  }, [tickMs])
  void tick
  return Date.now() + offset
}
