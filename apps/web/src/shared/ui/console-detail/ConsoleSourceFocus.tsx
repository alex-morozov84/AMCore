'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import type { ConsoleSourceRequest } from './console-source-selection'

/** A read-only destination marker; it neither fetches nor changes source data. */
export function ConsoleSourceFocus({
  rootId,
  request,
  available,
}: {
  rootId: string
  request: ConsoleSourceRequest
  available: boolean
}) {
  const t = useTranslations('console.problems')
  const lastFocused = useRef<string | null>(null)
  const [missing, setMissing] = useState<string | null>(null)
  const selection = request.selection
  const key = selection
    ? `${selection.kind}${selection.state ? '-errors' : ''}:${selection.id}`
    : ''
  useEffect(() => {
    if (!key) lastFocused.current = null
    if (!key || !available) return
    const root = document.getElementById(rootId)
    if (!root) return
    const check = () => {
      const targets = Array.from(
        root.querySelectorAll<HTMLElement>('[data-console-source]')
      ).filter((node) => node.dataset.consoleSource === key)
      const target = targets.find((node) => node.getClientRects().length > 0)
      setMissing(target ? null : key)
      if (!target || lastFocused.current === key) return
      lastFocused.current = key
      target.focus({ preventScroll: true })
      target.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      })
    }
    check()
    const observer = new MutationObserver(check)
    observer.observe(root, { subtree: true, childList: true })
    return () => observer.disconnect()
  }, [key, rootId, available])
  if (!request.invalid && (!key || !available || missing !== key)) return null
  return (
    <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">
      {t(request.invalid ? 'focusInvalid' : 'focusMissing')}
    </p>
  )
}
