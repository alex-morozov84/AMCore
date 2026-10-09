'use client'
import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { CapabilityCatalogueResponse } from '@amcore/shared'

import { useCatalogueText } from '@/entities/organization-context'
import { Checkbox } from '@/shared/ui/checkbox'
import { SearchField } from '@/shared/ui/search-field'

import { type AreaView, areaViews, isAreaOpen, isLarge } from '../model/catalogue-view'
import { presetKey } from '../model/role-draft'

type Capability = CapabilityCatalogueResponse['capabilities'][number]

interface Props {
  capabilities: readonly Capability[]
  keys: readonly string[]
  disabled: boolean
  onToggle: (capabilityId: string, presetId: string) => void
}

/**
 * Catalogue-driven: every supported operation appears under its area with the levels its
 * descriptor offers. A downstream descriptor without translations still renders by its id. With a
 * large catalogue the areas collapse and a search and an "only configured" filter appear; with a
 * small one the flat list stays as it is.
 */
export function CapabilityEditor(props: Props) {
  return isLarge(props.capabilities) ? <LargeCatalogue {...props} /> : <FlatCatalogue {...props} />
}

function FlatCatalogue({ capabilities, keys, disabled, onToggle }: Props) {
  const text = useCatalogueText()
  const views = areaViews(capabilities, keys, { query: '', onlyConfigured: false }, () => ({
    area: '',
  }))
  return (
    <div className="space-y-6">
      {views.map(({ area, items }) => (
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

function LargeCatalogue({ capabilities, keys, disabled, onToggle }: Props) {
  const t = useTranslations('organizationRoles')
  const text = useCatalogueText()
  const searchId = useId()
  const [query, setQuery] = useState('')
  const [onlyConfigured, setOnlyConfigured] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const searching = query.trim() !== '' || onlyConfigured
  const views = areaViews(capabilities, keys, { query, onlyConfigured }, (capability) => ({
    label: text.capability(capability.labelKey)?.label,
    description: text.capability(capability.labelKey)?.description,
    area: text.area(capability.subject),
  }))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <SearchField
          id={searchId}
          name="capability-search"
          className="min-w-64 flex-1"
          value={query}
          onValueChange={setQuery}
          onClear={() => setQuery('')}
          label={t('capabilitySearch')}
          placeholder={t('capabilitySearchPlaceholder')}
          clearLabel={t('capabilitySearchClear')}
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={onlyConfigured}
            onCheckedChange={(next) => setOnlyConfigured(next === true)}
          />
          <span>{t('onlyConfigured')}</span>
        </label>
      </div>
      {views.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('noCapabilityMatches')}
        </p>
      )}
      {views.map((view) => (
        <AreaSection
          key={view.area}
          view={view}
          open={isAreaOpen(view, open, searching)}
          onOpenChange={(next) => setOpen((state) => ({ ...state, [view.area]: next }))}
          keys={keys}
          disabled={disabled}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

function AreaSection({
  view,
  open,
  onOpenChange,
  keys,
  disabled,
  onToggle,
}: {
  view: AreaView
  open: boolean
  onOpenChange: (open: boolean) => void
} & Pick<Props, 'keys' | 'disabled' | 'onToggle'>) {
  const t = useTranslations('organizationRoles')
  const text = useCatalogueText()
  return (
    <details
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      className="rounded-lg border border-border p-4"
    >
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm font-semibold">
        <span>{text.area(view.area)}</span>
        <span className="font-normal text-muted-foreground">
          {t('areaConfigured', { configured: view.configured, total: view.total })}
        </span>
      </summary>
      <div className="mt-3 space-y-3">
        {view.items.map((capability) => (
          <CapabilityRow
            key={capability.id}
            capability={capability}
            keys={keys}
            disabled={disabled}
            onToggle={onToggle}
          />
        ))}
      </div>
    </details>
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
