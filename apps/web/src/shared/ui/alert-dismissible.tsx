'use client'

import { type ComponentProps, useRef, useState } from 'react'
import { XIcon } from 'lucide-react'

import { Button } from './button'

export function DismissibleAlert({
  closeLabel,
  dismissFocusTargetId,
  children,
  ...props
}: ComponentProps<'div'> & { closeLabel: string; dismissFocusTargetId: string }) {
  const [dismissed, setDismissed] = useState(false)
  const close = useRef<HTMLButtonElement>(null)
  function dismiss() {
    const button = close.current
    if (!button) return
    const document = button.ownerDocument
    const target = document.getElementById(dismissFocusTargetId)
    const root = button.parentElement
    if (
      !target?.isConnected ||
      root?.contains(target) ||
      target.closest('[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"]') ||
      target.matches(':disabled') ||
      !target.checkVisibility({ visibilityProperty: true })
    )
      return
    target.focus({ preventScroll: true })
    if (document.activeElement === target) setDismissed(true)
    else button.focus({ preventScroll: true })
  }
  if (dismissed) return null
  return (
    <div data-slot="alert" {...props}>
      {children}
      <Button
        ref={close}
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-2 right-2"
        aria-label={closeLabel}
        onClick={dismiss}
      >
        <XIcon aria-hidden="true" />
      </Button>
    </div>
  )
}
