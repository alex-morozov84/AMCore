'use client'

import type { ComponentType } from 'react'
import { useTranslations } from 'next-intl'
import type { IntegrationEvidence, IntegrationItem } from '@amcore/shared'
import {
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleSlash,
  CircleX,
  Clock,
  TriangleAlert,
} from 'lucide-react'

import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'

import { evidenceAt, type Headline, headlineOf } from '../model/headline'

type Tone = 'success' | 'warning' | 'danger' | 'muted'
type Icon = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>

const TONE: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  muted: 'text-muted-foreground',
}

/** Icon and word together: the state is never carried by colour alone. */
function Status({ tone, icon: Icon, children }: { tone: Tone; icon: Icon; children: string }) {
  return (
    <p className={`flex items-center gap-1.5 font-medium ${TONE[tone]}`}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {children}
    </p>
  )
}

const HEADLINE: Record<Headline, { tone: Tone; icon: Icon }> = {
  cannotRead: { tone: 'warning', icon: CircleHelp },
  off: { tone: 'muted', icon: CircleSlash },
  notSetUp: { tone: 'muted', icon: CircleDashed },
  failed: { tone: 'danger', icon: CircleX },
  unknown: { tone: 'warning', icon: CircleHelp },
  simulated: { tone: 'warning', icon: TriangleAlert },
  working: { tone: 'success', icon: CircleCheck },
  checkPassed: { tone: 'success', icon: CircleCheck },
  lastCheckOld: { tone: 'warning', icon: TriangleAlert },
  setUpNotVerified: { tone: 'muted', icon: CircleDashed },
  inProgress: { tone: 'muted', icon: Clock },
}

export function IntegrationHeadline({ item, now }: { item: IntegrationItem; now: number }) {
  const t = useTranslations('console.integrations.headline')
  const key = headlineOf(item, evidenceAt(item.evidence, now))
  const { tone, icon } = HEADLINE[key]
  return (
    <Status tone={tone} icon={icon}>
      {t(key)}
    </Status>
  )
}

/** Localized name; a downstream integration without copy shows its registered name. */
export function IntegrationName({ item, now }: { item: IntegrationItem; now: number }) {
  const t = useTranslations('console.integrations')
  const key = `names.${item.id}` as Parameters<typeof t.has>[0]
  return (
    <div className="space-y-1">
      <p className="font-medium">{t.has(key) ? t(key) : item.name}</p>
      <IntegrationHeadline item={item} now={now} />
    </div>
  )
}

const INLINE_FACTS = new Set(['interval_seconds', 'catalogue_cache_seconds'])

function humanize(key: string): string {
  return key.replaceAll('_', ' ')
}

/** Provider facts: closed keys get copy, unknown keys show a readable key and the safe value. */
export function IntegrationFacts({ item }: { item: IntegrationItem }) {
  const t = useTranslations('console.integrations')
  if (item.facts.length === 0) return <span aria-hidden="true">{t('noValue')}</span>
  return (
    <ul className="space-y-0.5 text-sm">
      {item.facts.map((fact) => {
        const label = `fact.${fact.key}` as Parameters<typeof t.has>[0]
        const valueKey = `factValue.${String(fact.value)}` as Parameters<typeof t.has>[0]
        if (INLINE_FACTS.has(fact.key) && t.has(label))
          return (
            <li key={fact.key} className="text-muted-foreground">
              {t(label, { value: String(fact.value) })}
            </li>
          )
        const value =
          typeof fact.value === 'string' && t.has(valueKey) ? t(valueKey) : String(fact.value)
        return (
          <li key={fact.key}>
            <span className="text-muted-foreground">
              {t.has(label) ? t(label) : humanize(fact.key)}:{' '}
            </span>
            {value}
          </li>
        )
      })}
    </ul>
  )
}

const CONFIG_ICON: Record<IntegrationItem['configuration'], { tone: Tone; icon: Icon }> = {
  configured: { tone: 'success', icon: CircleCheck },
  not_configured: { tone: 'muted', icon: CircleDashed },
  disabled: { tone: 'muted', icon: CircleSlash },
}

export function IntegrationSetup({ item }: { item: IntegrationItem }) {
  const t = useTranslations('console.integrations.config')
  const { tone, icon } = CONFIG_ICON[item.configuration]
  return (
    <Status tone={tone} icon={icon}>
      {t(item.configuration)}
    </Status>
  )
}

const RESULT: Record<IntegrationEvidence['result'], { tone: Tone; icon: Icon }> = {
  none: { tone: 'muted', icon: CircleDashed },
  ok: { tone: 'success', icon: CircleCheck },
  failed: { tone: 'danger', icon: CircleX },
  unknown: { tone: 'warning', icon: CircleHelp },
  simulated: { tone: 'warning', icon: TriangleAlert },
}

type IntegrationsT = ReturnType<typeof useTranslations<'console.integrations'>>

/**
 * Failure codes are short slugs chosen by each integration, so one code can mean different things
 * on different rows. A row-specific `failureFor.<id>.<code>` wins over the shared `failure.<code>`.
 */
function failureText(t: IntegrationsT, id: string, code: string | null): string | null {
  if (!code) return null
  const specific = `failureFor.${id}.${code}` as Parameters<typeof t.has>[0]
  if (t.has(specific)) return t(specific)
  const shared = `failure.${code}` as Parameters<typeof t.has>[0]
  return t.has(shared) ? t(shared) : null
}

/** Last observation: what, how old, where it was taken, and the safe reason when it failed. */
export function IntegrationLastCheck({ item, now }: { item: IntegrationItem; now: number }) {
  const t = useTranslations('console.integrations')
  if (item.source === 'unavailable')
    return (
      <Status tone="warning" icon={CircleHelp}>
        {t('headline.cannotRead')}
      </Status>
    )
  const evidence = evidenceAt(item.evidence, now)
  const { tone, icon } = RESULT[evidence.result]
  const failure = failureText(t, item.id, evidence.failure)
  const missing = evidence.result === 'none' && evidence.scope === 'provider_acceptance'
  const resultWord = t(`result.${evidence.result}`)
  const word = missing
    ? t('noStoredResult')
    : evidence.freshness === 'stale'
      ? t('resultStale', { result: resultWord })
      : resultWord
  return (
    <div className="space-y-0.5">
      <Status tone={tone} icon={icon}>
        {word}
      </Status>
      {/* The reason is what the operator acts on: right under the result, in its tone, aligned with the word. */}
      {failure && <p className={`pl-5.5 text-sm ${TONE[tone]}`}>{failure}</p>}
      {evidence.checkedAt && (
        <p className="text-sm text-muted-foreground">
          <ConsoleTimestamp value={evidence.checkedAt} variant="inline" seconds /> ·{' '}
          {t(`instance.${evidence.instance}`)}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{t(`scope.${evidence.scope}`)}</p>
    </div>
  )
}
