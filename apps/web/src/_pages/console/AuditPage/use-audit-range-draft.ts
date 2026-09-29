'use client'

import { useState } from 'react'

import { useConsoleTimeZone } from '@/shared/lib/console-time-zone'

import { editAuditEndpoint, knownAuditEndpoint, projectAuditEndpoint } from './audit-endpoint-state'

export function useAuditRangeDraft(start: string, end: string) {
  const { mode } = useConsoleTimeZone()
  const [from, setFrom] = useState(() => knownAuditEndpoint(start, mode))
  const [to, setTo] = useState(() => knownAuditEndpoint(end, mode))
  return {
    from: projectAuditEndpoint(from, mode),
    to: projectAuditEndpoint(to, mode),
    setFrom: (text: string) => setFrom(editAuditEndpoint(text, mode)),
    setTo: (text: string) => setTo(editAuditEndpoint(text, mode)),
    setInstants: (start: string, end: string) => {
      setFrom(knownAuditEndpoint(start, mode))
      setTo(knownAuditEndpoint(end, mode))
    },
  }
}
