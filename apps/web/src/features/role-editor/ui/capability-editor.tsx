'use client'
import { useId } from 'react'
import { useTranslations } from 'next-intl'
import type { CapabilityCatalogueResponse } from '@amcore/shared'

import { Checkbox } from '@/shared/ui/checkbox'

import { presetKey } from '../model/role-draft'
import { useCatalogueText } from '../model/use-catalogue-text'

type Capability = CapabilityCatalogueResponse['capabilities'][number]

function groupByArea(capabilities: readonly Capability[]) {
  const groups = new Map<string, Capability[]>()
  for (const capability of capabilities)
    groups.set(capability.subject, [...(groups.get(capability.subject) ?? []), capability])
  return [...groups]
}

/**
 * Catalogue-driven: every supported operation appears under its area with the levels its
 * descriptor offers. A downstream descriptor without translations still renders by its id.
 */
export function CapabilityEditor({
  capabilities,
  keys,
  disabled,
  onToggle,
}: {
  capabilities: readonly Capability[]
  keys: readonly string[]
  disabled: boolean
  onToggle: (capabilityId: string, presetId: string) => void
}) {
  const text = useCatalogueText()
  return (
    <div className="space-y-6">
      {groupByArea(capabilities).map(([area, items]) => (
        <fieldset key={area} className="space-y-3 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-semibold">{text.area(area)}</legend>
          {items.map((capability) => (
            <CapabilityRow
              key={capability.id}
              capability={capability}
              keys={keys}
              disabled={disabled}
              onToggle={onToggle}
            />
          ))}
        </fieldset>
      ))}
    </div>
  )
}

function CapabilityRow({
  capability,
  keys,
  disabled,
  onToggle,
}: {
  capability: Capability
  keys: readonly string[]
  disabled: boolean
  onToggle: (capabilityId: string, presetId: string) => void
}) {
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
