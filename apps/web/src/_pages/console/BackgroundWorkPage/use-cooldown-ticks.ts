'use client'

import { useEffect } from 'react'

import type { PollFloors } from './queue-poll-policy'

/**
 * Re-renders the owner when a cool-down ends. Each floor expires on its own clock, so a short
 * `Retry-After` frees manual refresh even while a longer automatic backoff still holds back
 * automatic fetches. While a `Retry-After` is active the state also ticks once a second, so the
 * remaining time shown is honest. One-shot timers and one interval: no polling loop.
 */
export function useCooldownTicks(floors: PollFloors, setNow: (now: number) => void): void {
  useEffect(() => {
    const at = Date.now()
    const ends = [floors.retryAfterUntil, floors.backoffUntil].filter((until) => until > at)
    const stops: Array<() => void> = ends.map((until) => {
      const timer = setTimeout(() => setNow(Date.now()), until - at + 1)
      return () => clearTimeout(timer)
    })
    if (floors.retryAfterUntil > at) {
      const ticker = setInterval(() => {
        const current = Date.now()
        setNow(current)
        if (current >= floors.retryAfterUntil) clearInterval(ticker)
      }, 1_000)
      stops.push(() => clearInterval(ticker))
    }
    return () => stops.forEach((stop) => stop())
  }, [floors, setNow])
}
