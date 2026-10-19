'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'

export function CopyButton({
  onCopy,
  label,
  copied,
  failed,
  eventName = 'copy-button-used',
  disabled = false,
}: {
  onCopy: () => Promise<boolean>
  label: string
  copied: string
  failed: string
  disabled?: boolean
  eventName?: string
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const buttonId = useId()
  const pendingRef = useRef(false)
  const activeRef = useRef(true)
  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
    }
  }, [])
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (state === 'idle') return
    const timer = window.setTimeout(() => setState('idle'), 1800)
    return () => window.clearTimeout(timer)
  }, [state])
  useEffect(() => {
    const resetOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== buttonId) setState('idle')
    }
    window.addEventListener(eventName, resetOther)
    return () => window.removeEventListener(eventName, resetOther)
  }, [buttonId, eventName])
  return (
    <>
      <button
        disabled={disabled || pending}
        aria-busy={pending}
        type="button"
        onClick={async () => {
          if (pendingRef.current) return
          pendingRef.current = true
          setPending(true)
          try {
            if (!(await onCopy())) throw new Error('COPY_FAILED')
            if (!activeRef.current) return
            window.dispatchEvent(new CustomEvent(eventName, { detail: buttonId }))
            setState('copied')
          } catch {
            setState('failed')
          } finally {
            pendingRef.current = false
            setPending(false)
          }
        }}
        aria-label={label}
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
      <span role="status" className="sr-only">
        {state === 'copied' ? copied : state === 'failed' ? failed : ''}
      </span>
    </>
  )
}
