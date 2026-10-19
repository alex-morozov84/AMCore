'use client'
import { useId } from 'react'
import { useTranslations } from 'next-intl'
import type { CapabilityCatalogueResponse } from '@amcore/shared'

import { CapabilitySelection, useCatalogueText } from '@/entities/organization-context'
import { Checkbox } from '@/shared/ui/checkbox'

import { presetKey } from '../model/role-draft'

type Capability = Omit<CapabilityCatalogueResponse['capabilities'][number], 'id' | 'presets'> & {
  id: string
  presets: readonly string[]
}

interface Props {
  capabilities: readonly Capability[]
  keys: readonly string[]
  disabled: boolean
  onToggle: (capabilityId: string, presetId: string) => void
}

export function CapabilityEditor({ capabilities, keys, disabled, onToggle }: Props) {
  return (
    <CapabilitySelection
      capabilities={capabilities}
      configured={(capability) =>
        capability.presets.some((preset) => keys.includes(presetKey(capability.id, preset)))
      }
      renderRow={(capability) => (
        <CapabilityRow
          capability={capability}
          keys={keys}
          disabled={disabled}
          onToggle={onToggle}
        />
      )}
    />
  )
}

function CapabilityRow({
  capability,
  keys,
  disabled,
  onToggle,
}: {
  capability: Capability
} & Pick<Props, 'keys' | 'disabled' | 'onToggle'>) {
  const t = useTranslations('organizationRoles')
  const labelId = useId()
  const text = useCatalogueText()
  const known = text.capability(capability.labelKey)
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft pb-3 last:border-b-0 last:pb-0">
      <div className="min-w-0 flex-1 space-y-1">
        <p id={labelId} className="font-medium">
          {known ? known.label : t('capabilityUnknown', { id: capability.id })}
          {capability.risk === 'fullControl' && (
            <span className="ml-2 rounded border border-border px-2 py-0.5 text-xs">
              {t('flagFullControl')}
            </span>
          )}
        </p>
        {known?.description && <p className="text-sm text-muted-foreground">{known.description}</p>}
      </div>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-4">
        {capability.presets.map((preset) => (
          <label key={preset} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={keys.includes(presetKey(capability.id, preset))}
              disabled={disabled}
              onCheckedChange={() => onToggle(capability.id, preset)}
            />
            <span title={text.level(preset).hint}>{text.level(preset).label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
