'use client'

import { useEffect, useId, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'

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
  const buttonId = useId()
  useEffect(() => {
    if (state === 'idle') return
    const timer = window.setTimeout(() => setState('idle'), 1800)
    return () => window.clearTimeout(timer)
  }, [state])
  useEffect(() => {
    const resetOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== buttonId) setState('idle')
    }
    window.addEventListener('audit-id-copied', resetOther)
    return () => window.removeEventListener('audit-id-copied', resetOther)
  }, [buttonId])
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(id)
          window.dispatchEvent(new CustomEvent('audit-id-copied', { detail: buttonId }))
          setState('copied')
        } catch {
          setState('failed')
        }
      }}
      aria-label={`${label}: ${id}`}
      title={state === 'copied' ? copied : state === 'failed' ? failed : label}
      className="inline-flex shrink-0 cursor-pointer items-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2"
    >
      {state === 'copied' ? (
        <Check aria-hidden size={14} />
      ) : state === 'failed' ? (
        <X aria-hidden size={14} />
      ) : (
        <Copy aria-hidden size={14} />
      )}
    </button>
  )
}
