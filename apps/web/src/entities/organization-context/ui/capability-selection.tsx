'use client'
import { type ReactNode, useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { CapabilityCatalogueResponse } from '@amcore/shared'

import { Checkbox } from '@/shared/ui/checkbox'
import { SearchField } from '@/shared/ui/search-field'

import { type AreaView, areaViews, isAreaOpen, isLarge } from '../model/catalogue-view'
import { useCatalogueText } from '../model/use-catalogue-text'

type Capability = Omit<CapabilityCatalogueResponse['capabilities'][number], 'id' | 'presets'> & {
  id: string
  presets: readonly string[]
}

interface Props {
  capabilities: readonly Capability[]
  configured: (capability: Capability) => boolean
  renderRow: (capability: Capability) => ReactNode
}

/**
 * Catalogue-driven: every supported operation appears under its area with the levels its
 * descriptor offers. A downstream descriptor without translations still renders by its id. With a
 * large catalogue the areas collapse and a search and an "only configured" filter appear; with a
 * small one the flat list stays as it is.
 */
export function CapabilitySelection(props: Props) {
  return isLarge(props.capabilities) ? <LargeCatalogue {...props} /> : <FlatCatalogue {...props} />
}

function FlatCatalogue({ capabilities, configured, renderRow }: Props) {
  const text = useCatalogueText()
  const views = areaViews(capabilities, configured, { query: '', onlyConfigured: false }, () => ({
    area: '',
  }))
  return (
    <div className="space-y-6">
      {views.map(({ area, items }) => (
        <fieldset key={area} className="space-y-3 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-semibold">{text.area(area)}</legend>
          {items.map((capability) => (
            <div key={capability.id}>{renderRow(capability)}</div>
          ))}
        </fieldset>
      ))}
    </div>
  )
}

function LargeCatalogue({ capabilities, configured, renderRow }: Props) {
  const t = useTranslations('organizationRoles')
  const text = useCatalogueText()
  const searchId = useId()
  const [query, setQuery] = useState('')
  const [onlyConfigured, setOnlyConfigured] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const searching = query.trim() !== '' || onlyConfigured
  const views = areaViews(capabilities, configured, { query, onlyConfigured }, (capability) => ({
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
          renderRow={renderRow}
        />
      ))}
    </div>
  )
}

function AreaSection({
  view,
  open,
  onOpenChange,
  renderRow,
}: {
  view: AreaView
  open: boolean
  onOpenChange: (open: boolean) => void
} & Pick<Props, 'renderRow'>) {
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
          <div key={capability.id}>{renderRow(capability)}</div>
        ))}
      </div>
    </details>
  )
}
