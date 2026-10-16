import { useEffect, useState } from 'react'

import 'client-only'

/** One server-provided retry deadline; no polling or automatic request retry. */
export function useRetryDeadline(deadline: number | undefined): boolean {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (deadline === undefined) return
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, deadline - Date.now()))
    return () => clearTimeout(timer)
  }, [deadline])
  return (deadline ?? 0) > now
}
