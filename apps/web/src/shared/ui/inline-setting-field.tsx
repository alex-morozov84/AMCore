'use client'

import type { ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'

import { Button } from './button'
import { InfoTooltip } from './info-tooltip'

interface InlineSettingFieldProps {
  children: ReactNode
  prefix: string
  suffix?: string
  help: string
  changed: boolean
  saving: boolean
  disabled: boolean
  cancelDisabled: boolean
  saveLabel: string
  savingLabel: string
  cancelLabel: string
  onCancel: () => void
}

/** Presentation for a single setting; the caller owns its form and saved state. */
export function InlineSettingField({
  children,
  prefix,
  suffix,
  help,
  changed,
  saving,
  disabled,
  cancelDisabled,
  saveLabel,
  savingLabel,
  cancelLabel,
  onCancel,
}: InlineSettingFieldProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{prefix}</span>
        {children}
        {suffix && <span>{suffix}</span>}
        <InfoTooltip label={help} />
      </div>
      {changed && (
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={disabled} aria-busy={saving}>
            {saving && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            {saving ? savingLabel : saveLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={cancelDisabled}
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
        </div>
      )}
    </div>
  )
}
