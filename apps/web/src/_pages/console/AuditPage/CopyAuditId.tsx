'use client'

import { useState } from 'react'

export function CopyAuditId({
  id,
  label,
  copied,
  failed,
}: {
  id: string
  label: string
  copied: string
  failed: string
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(id)
          setState('copied')
        } catch {
          setState('failed')
        }
      }}
      aria-label={`${label}: ${id}`}
      className="rounded underline-offset-2 hover:underline focus-visible:outline-2"
    >
      {state === 'copied' ? copied : state === 'failed' ? failed : label}
    </button>
  )
}
