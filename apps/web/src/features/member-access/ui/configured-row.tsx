'use client'
import { useTranslations } from 'next-intl'
import type { AccessConfiguredItem } from '@amcore/shared'

import { configuredWhy, type ConfiguredWhyLine } from '../model/access-view'

import { type AccessTranslator, describeText } from './role-text'

type Area = AccessConfiguredItem['areas'][number]
type Limit = AccessConfiguredItem['limits'][number]

interface Context {
  nameOf: (id: string) => string | undefined
  fieldLabel: (field: string) => string
}

/** What the role settings configure, area by area, with what limits it and why it may not apply. */
export function ConfiguredExplanation({
  item,
  nameOf,
  fieldLabel,
}: { item: AccessConfiguredItem } & Context) {
  const t = useTranslations('memberAccess')
  const roles = (area: Area) => describeText(area.roles, nameOf, t)
  if (item.state === 'none') return <p>{t('reasonNoGrant')}</p>
  return (
    <div className="space-y-1">
      {item.state === 'blocked' && (
        <p>{t('stateBlocked', { blockers: describeText(item.blockedBy, nameOf, t) })}</p>
      )}
      {item.state === 'missingPrerequisite' && <p>{t('stateMissing')}</p>}
      {item.state === 'configured' && <p>{t('stateConfigured')}</p>}
      <ul className="space-y-1">
        {item.areas
          .filter((area) => !area.absorbed)
          .map((area) => (
            <li key={area.kind}>
              {t('areaRoles', { area: t(`area.${area.kind}`), roles: roles(area) })}
              {area.masked && ` (${t('blocked')})`}
              <PrerequisiteNote area={area} state={item.state} t={t} />
            </li>
          ))}
      </ul>
      {item.areas.some((area) => area.absorbed) && <p>{t('absorbedNote')}</p>}
      <ul className="space-y-1">
        {item.limits.map((limit) => (
          <li key={limit.kind}>{limitText(limit, t, fieldLabel)}</li>
        ))}
      </ul>
    </div>
  )
}

function PrerequisiteNote({
  area,
  state,
  t,
}: {
  area: Area
  state: AccessConfiguredItem['state']
  t: AccessTranslator
}) {
  // A missing prerequisite is already the headline of the row; only name the weaker cases here.
  if (state === 'missingPrerequisite' || area.masked) return null
  if (
    area.prerequisite !== 'unproven' &&
    area.prerequisite !== 'missing' &&
    area.prerequisite !== 'blocked'
  )
    return null
  return <span className="block text-xs">{t(`prerequisite.${area.prerequisite}`)}</span>
}

function limitText(
  limit: Limit,
  t: AccessTranslator,
  fieldLabel: (field: string) => string
): string {
  const fields = (limit.fields ?? []).map(fieldLabel).join(', ')
  return t(`limit.${limit.kind}`, { fields })
}

/** The rules behind a configured row, by area and cause; the area of a rule is never merged away. */
export function ConfiguredSources({
  item,
  nameOf,
}: { item: AccessConfiguredItem } & Pick<Context, 'nameOf'>) {
  const t = useTranslations('memberAccess')
  const lines = configuredWhy(item)
  const roles = (line: ConfiguredWhyLine) =>
    describeText({ roleIds: line.roleIds, total: line.roleIds.length }, nameOf, t)
  return (
    <ul className="mt-2 space-y-1">
      {lines.map((line) => (
        <li
          key={`${line.kind}-${line.area ?? ''}-${line.via ?? ''}-${line.roleIds.join()}`}
          className={line.kind === 'blocks' ? 'font-medium' : undefined}
        >
          {line.kind === 'allows' && (
            <>
              {t('whyConfigured.allows', {
                area: line.area ? t(`area.${line.area}`) : '',
                roles: roles(line),
              })}
            </>
          )}
          {line.kind === 'overridden' && (
            <>{t('whyConfigured.overridden', { roles: roles(line) })}</>
          )}
          {line.kind === 'restricts' && <>{t('whyConfigured.restricts', { roles: roles(line) })}</>}
          {line.kind === 'blocks' &&
            (line.via ? (
              <>{t('whyConfigured.blocksVia', { roles: roles(line), via: t(`via.${line.via}`) })}</>
            ) : (
              <>{t('whyConfigured.blocks', { roles: roles(line) })}</>
            ))}
        </li>
      ))}
      {lines.some((line) => line.kind === 'blocks') && (
        <li className="text-muted-foreground">{t('why.denyWins')}</li>
      )}
      {item.sourcesTruncated && <li className="text-muted-foreground">{t('sourcesMore')}</li>}
    </ul>
  )
}

export const hasConfiguredWhy = (item: AccessConfiguredItem): boolean =>
  configuredWhy(item).length > 0 || item.sourcesTruncated
