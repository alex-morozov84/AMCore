'use client'
import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { CapabilityCatalogueResponse, MemberAccess } from '@amcore/shared'

import { useCatalogueText } from '@/entities/organization-context'
import { RoleBadges } from '@/shared/ui/role-badges'
import { SearchField } from '@/shared/ui/search-field'

import { groupByArea, type splitItems, summaryCounts } from '../model/access-view'
import type { AccessLabels } from '../model/use-access-labels'

import { AccessRow, CompactAccessRow } from './access-row'

type Item = MemberAccess['items'][number]
type Capabilities = CapabilityCatalogueResponse['capabilities']
type Parts = ReturnType<typeof splitItems>

/** Above this many listed items the list gets a search and collapsible areas. */
const LARGE_LIST = 12
/** An area with at most this many items stays open without a search. */
const SMALL_AREA = 5

export function AccessRoles({ access }: { access: MemberAccess }) {
  const t = useTranslations('memberAccess')
  return (
    <section aria-labelledby="member-access-roles" className="space-y-2">
      <h3 id="member-access-roles" className="text-base font-semibold">
        {t('rolesTitle')}
      </h3>
      <RoleBadges roles={access.roles.items} empty={t('rolesNone')} />
      {access.roles.truncated && (
        <p className="text-sm text-muted-foreground">
          {t('rolesMore', { count: access.roles.total - access.roles.items.length })}
        </p>
      )}
    </section>
  )
}

/** What the person can do, is configured for or is blocked from, grouped by area. */
export function AccessItems({
  parts,
  capabilities,
  labels,
  nameOf,
}: {
  parts: Parts
  capabilities: Capabilities
  labels: AccessLabels
  nameOf: (id: string) => string | undefined
}) {
  const t = useTranslations('memberAccess')
  const text = useCatalogueText()
  const searchId = useId()
  const [query, setQuery] = useState('')
  const counts = summaryCounts(parts.active)
  const large = parts.active.length > LARGE_LIST
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = parts.active.filter((item) =>
    words.every((word) => labels.labelOf(item.key).toLowerCase().includes(word))
  )
  const row = (item: Item) => (
    <AccessRow
      key={item.key}
      item={item}
      label={labels.labelOf(item.key)}
      nameOf={nameOf}
      fieldLabel={labels.fieldLabel}
    />
  )
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {t('summaryAllowed', { count: counts.allowed })}
        {counts.configured > 0 && `, ${t('summaryConfigured', { count: counts.configured })}`}
        {counts.blocked > 0 && `, ${t('summaryBlocked', { count: counts.blocked })}`}
      </p>
      {parts.active.some((item) => item.evaluation === 'configured') && (
        <p className="text-sm text-muted-foreground">{t('configuredNote')}</p>
      )}
      {large && (
        <SearchField
          id={searchId}
          name="access-search"
          value={query}
          onValueChange={setQuery}
          onClear={() => setQuery('')}
          label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
          clearLabel={t('searchClear')}
        />
      )}
      {large && shown.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('noMatches')}
        </p>
      )}
      {groupByArea(shown, capabilities).map(([area, items]) =>
        large ? (
          <details
            key={area}
            open={query.trim() !== '' || items.length <= SMALL_AREA}
            className="rounded-lg border border-border p-3"
          >
            <summary className="cursor-pointer text-sm font-semibold">
              {t('areaCount', { area: text.area(area), count: items.length })}
            </summary>
            <ul className="mt-2 space-y-2">{items.map(row)}</ul>
          </details>
        ) : (
          <div key={area} className="space-y-2">
            <h4 className="text-sm font-semibold">{text.area(area)}</h4>
            <ul className="space-y-2">{items.map(row)}</ul>
          </div>
        )
      )}
    </>
  )
}

/** What no role gives, by area, and what the product did not evaluate: both collapsed, both apart. */
export function AccessInactive({
  parts,
  capabilities,
  labels,
}: {
  parts: Parts
  capabilities: Capabilities
  labels: AccessLabels
}) {
  const t = useTranslations('memberAccess')
  const text = useCatalogueText()
  return (
    <>
      {parts.inactive.length > 0 && (
        <details className="rounded-lg border border-border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            {t('notAllowedTitle', { count: parts.inactive.length })}
          </summary>
          <p className="mt-2 text-muted-foreground">{t('notAllowedHint')}</p>
          <div className="mt-2 space-y-2">
            {groupByArea(parts.inactive, capabilities).map(([area, items]) => (
              <details key={area} className="rounded-md border border-border p-2">
                <summary className="cursor-pointer font-medium">
                  {t('areaCount', { area: text.area(area), count: items.length })}
                </summary>
                <ul className="mt-2 space-y-1">
                  {items.map((item) => (
                    <CompactAccessRow key={item.key} item={item} label={labels.labelOf(item.key)} />
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </details>
      )}
      {parts.notEvaluated.length > 0 && (
        <details className="rounded-lg border border-dashed border-border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            {t('notEvaluatedTitle', { count: parts.notEvaluated.length })}
          </summary>
          <p className="mt-2 text-muted-foreground">{t('notEvaluatedHint')}</p>
          <ul className="mt-2 space-y-1">
            {parts.notEvaluated.map((item) => (
              <CompactAccessRow key={item.key} item={item} label={labels.labelOf(item.key)} />
            ))}
          </ul>
        </details>
      )}
    </>
  )
}
