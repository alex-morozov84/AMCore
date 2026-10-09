'use client'
import { useTranslations } from 'next-intl'
import type { MemberAccess } from '@amcore/shared'
import { Check, Minus, ShieldAlert } from 'lucide-react'

import { cn } from '@/shared/lib/utils'

import { describeRoles, type Tone, toneOf } from '../model/access-view'

type Item = MemberAccess['items'][number]

const TONE_STYLE: Record<Tone, string> = {
  included: 'border-border',
  allowed: 'border-success/60 bg-success-soft',
  blocked: 'border-warning/60 bg-warning-soft',
  denied: 'border-border',
}

export function AccessRow({
  item,
  label,
  nameOf,
  fieldLabel,
}: {
  item: Item
  label: string
  nameOf: (id: string) => string | undefined
  fieldLabel: (field: string) => string
}) {
  const t = useTranslations('memberAccess')
  const tone = toneOf(item)
  const badge =
    tone === 'included'
      ? t('included')
      : tone === 'allowed'
        ? t('allowed')
        : tone === 'blocked'
          ? t('blocked')
          : t('notAllowed')
  const Icon =
    tone === 'allowed' || tone === 'included' ? Check : tone === 'blocked' ? ShieldAlert : Minus
  return (
    <li className={cn('space-y-2 rounded-lg border p-3', TONE_STYLE[tone])}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 break-words font-medium">{label}</p>
        <span className="inline-flex items-center gap-1 text-sm font-medium">
          <Icon aria-hidden="true" className="size-4" />
          {badge}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        <Explanation item={item} nameOf={nameOf} />
      </p>
      {item.granted && item.actorHint === 'recordRequired' && (
        <p className="text-xs text-muted-foreground">{t('recordDependent')}</p>
      )}
      {!item.baseline && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">{t('whyTitle')}</summary>
          <Sources item={item} nameOf={nameOf} fieldLabel={fieldLabel} />
        </details>
      )}
    </li>
  )
}

function Explanation({ item, nameOf }: { item: Item; nameOf: (id: string) => string | undefined }) {
  const t = useTranslations('memberAccess')
  if (item.baseline) return <>{t('baselineNote')}</>
  if (item.granted) {
    if (item.origin === 'combined') return <>{t('originCombined')}</>
    if (item.origin === 'single')
      return <>{t('originSingle', { roles: describeText(item.reachedBy, nameOf, t) })}</>
    return null
  }
  if (item.reason === 'vetoed')
    return (
      <>
        {t('reasonVetoed', {
          granted: describeText(item.grantedBy, nameOf, t),
          blockers: describeText(item.vetoedBy, nameOf, t),
        })}
      </>
    )
  if (item.reason === 'missingPrerequisite') return <>{t('reasonMissing')}</>
  if (item.reason === 'noGrant') return <>{t('reasonNoGrant')}</>
  return <>{t('reasonUnknown')}</>
}

function describeText(
  refs: Item['reachedBy'],
  nameOf: (id: string) => string | undefined,
  t: ReturnType<typeof useTranslations<'memberAccess'>>
): string {
  const { names, more } = describeRoles(refs, nameOf, t('roleUnknown'))
  return more > 0 ? `${names.join(', ')} ${t('rolesMore', { count: more })}` : names.join(', ')
}

function Sources({
  item,
  nameOf,
  fieldLabel,
}: {
  item: Item
  nameOf: (id: string) => string | undefined
  fieldLabel: (field: string) => string
}) {
  const t = useTranslations('memberAccess')
  if (item.sources.length === 0) return <p className="mt-1 text-muted-foreground">{t('whyNone')}</p>
  return (
    <ul className="mt-2 space-y-2">
      {item.sources.map((source, index) =>
        source.kind === 'rule' ? (
          <li key={`${source.permissionId}-${source.via}-${source.field ?? ''}-${index}`}>
            <p className="font-medium">
              {t(`effect.${source.effect}`)}, {t(`status.${source.status}`)}
            </p>
            <p className="text-muted-foreground">
              {t(`via.${source.via}`)}
              {source.field ? ` (${fieldLabel(source.field)})` : ''}
            </p>
            <p className="text-muted-foreground">
              {t('sourceRoles', {
                roles: describeText(
                  { roleIds: source.roleIds, total: source.roleIds.length },
                  nameOf,
                  t
                ),
              })}
            </p>
          </li>
        ) : null
      )}
      {item.sourcesTruncated && <li className="text-muted-foreground">{t('sourcesMore')}</li>}
    </ul>
  )
}
