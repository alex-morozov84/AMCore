'use client'
import { useTranslations } from 'next-intl'
import type { MemberAccess } from '@amcore/shared'
import { Check, Minus, ShieldAlert } from 'lucide-react'

import { cn } from '@/shared/lib/utils'

import { describeRoles, explainWhy, type Tone, toneOf, type WhyLine } from '../model/access-view'

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
}: {
  item: Item
  label: string
  nameOf: (id: string) => string | undefined
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
      {!item.baseline && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">{t('whyTitle')}</summary>
          <Sources item={item} nameOf={nameOf} />
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

function Sources({ item, nameOf }: { item: Item; nameOf: (id: string) => string | undefined }) {
  const t = useTranslations('memberAccess')
  const why = explainWhy(item)
  const roles = (line: WhyLine) =>
    describeText({ roleIds: line.roleIds, total: line.roleIds.length }, nameOf, t)
  const none = why.allows.length + why.blocks.length + why.needs.length === 0
  if (none) return <p className="mt-1 text-muted-foreground">{t('whyNone')}</p>
  return (
    <ul className="mt-2 space-y-1">
      {why.allows.map((line) => (
        <li key={`allow-${line.roleIds.join()}`}>{t('why.allows', { roles: roles(line) })}</li>
      ))}
      {why.blocks.map((line) => (
        <li key={`block-${line.via ?? ''}-${line.roleIds.join()}`} className="font-medium">
          {line.via
            ? t('why.blocksVia', { roles: roles(line), via: t(`via.${line.via}`) })
            : t('why.blocks', { roles: roles(line) })}
        </li>
      ))}
      {why.needs.map((line) => (
        <li key={`need-${line.via}`} className="text-muted-foreground">
          {t('why.needs', { via: t(`via.${line.via ?? 'direct'}`), roles: roles(line) })}
        </li>
      ))}
      {why.blocks.length > 0 && <li className="text-muted-foreground">{t('why.denyWins')}</li>}
      {item.sourcesTruncated && <li className="text-muted-foreground">{t('sourcesMore')}</li>}
    </ul>
  )
}

/** A one-line row for something no role gives: it has nothing to explain beyond a missing prerequisite. */
export function CompactAccessRow({ item, label }: { item: Item; label: string }) {
  const t = useTranslations('memberAccess')
  return (
    <li className="text-sm">
      <span>{label}</span>
      {item.reason === 'missingPrerequisite' && (
        <span className="block text-muted-foreground">{t('reasonMissing')}</span>
      )}
    </li>
  )
}
