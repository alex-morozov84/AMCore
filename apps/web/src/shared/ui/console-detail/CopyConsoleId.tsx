'use client'

import { CopyButton } from '../copy-button'

export function CopyConsoleId({
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
  return (
    <CopyButton
      label={`${label}: ${id}`}
      copied={copied}
      failed={failed}
      eventName="console-id-copied"
      onCopy={async () => {
        await navigator.clipboard.writeText(id)
        return true
      }}
    />
  )
}
