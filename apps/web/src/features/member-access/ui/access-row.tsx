'use client'
import { useTranslations } from 'next-intl'
import type { AccessRecordItem, MemberAccess } from '@amcore/shared'
import { Check, CircleHelp, Minus, ShieldAlert, SlidersHorizontal } from 'lucide-react'

import { cn } from '@/shared/lib/utils'

import { explainWhy, type Tone, toneOf, type WhyLine } from '../model/access-view'

import { ConfiguredExplanation, ConfiguredSources, hasConfiguredWhy } from './configured-row'
import { describeText } from './role-text'

type Item = MemberAccess['items'][number]

const TONE_STYLE: Record<Tone, string> = {
  included: 'border-border',
  allowed: 'border-success/60 bg-success-soft',
  configured: 'border-border',
  blocked: 'border-warning/60 bg-warning-soft',
  ineffective: 'border-warning/60 bg-warning-soft',
  denied: 'border-border',
  unknown: 'border-dashed border-border',
}

const TONE_ICON = {
  included: Check,
  allowed: Check,
  configured: SlidersHorizontal,
  blocked: ShieldAlert,
  ineffective: ShieldAlert,
  denied: Minus,
  unknown: CircleHelp,
} as const

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
  const badges: Record<Tone, string> = {
    included: t('included'),
    allowed: t('allowed'),
    configured: t('configuredBadge'),
    blocked: t('blocked'),
    ineffective: t('ineffectiveBadge'),
    denied: t('notAllowed'),
    unknown: t('notEvaluatedRow'),
  }
  const Icon = TONE_ICON[tone]
  return (
    <li className={cn('space-y-2 rounded-lg border p-3', TONE_STYLE[tone])}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 break-words font-medium">{label}</p>
        <span className="inline-flex items-center gap-1 text-sm font-medium">
          <Icon aria-hidden="true" className="size-4" />
          {badges[tone]}
        </span>
      </div>
      <div className="text-sm text-muted-foreground">
        {item.evaluation === 'record' && <Explanation item={item} nameOf={nameOf} />}
        {item.evaluation === 'configured' && (
          <ConfiguredExplanation item={item} nameOf={nameOf} fieldLabel={fieldLabel} />
        )}
        {item.evaluation === 'notEvaluated' && <p>{t('notEvaluatedHint')}</p>}
      </div>
      {item.evaluation === 'record' && !item.baseline && hasWhy(item) && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">{t('whyTitle')}</summary>
          <Sources item={item} nameOf={nameOf} />
        </details>
      )}
      {item.evaluation === 'configured' && hasConfiguredWhy(item) && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">{t('whyTitle')}</summary>
          <ConfiguredSources item={item} nameOf={nameOf} />
        </details>
      )}
    </li>
  )
}

function Explanation({
  item,
  nameOf,
}: {
  item: AccessRecordItem
  nameOf: (id: string) => string | undefined
}) {
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

/** An item without rule-level sources has no "why" to open. */
function hasWhy(item: AccessRecordItem): boolean {
  const why = explainWhy(item)
  return why.allows.length + why.blocks.length + why.needs.length > 0 || item.sourcesTruncated
}

function Sources({
  item,
  nameOf,
}: {
  item: AccessRecordItem
  nameOf: (id: string) => string | undefined
}) {
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
      {item.evaluation === 'record' && item.reason === 'missingPrerequisite' && (
        <span className="block text-muted-foreground">{t('reasonMissing')}</span>
      )}
    </li>
  )
}
