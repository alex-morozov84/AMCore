import type { IntegrationItem } from '@amcore/shared'

import { getConsoleIntegrationsHref } from '@/shared/lib/console-public-href'

import { type ProblemContext, problemFact } from './overview-problem-model'

export function integrationProblem(ctx: ProblemContext, item: IntegrationItem) {
  if (item.id === 'storage' || item.id === 'queue') return
  const base = {
    key: `integration:${item.id}`,
    source: 'integrations' as const,
    name: ctx.name('integration', item.id, item.name),
    href: `${getConsoleIntegrationsHref()}?${new URLSearchParams({ focus: item.id })}`,
    action: 'openIntegration' as const,
    guide:
      item.id === 'telegram'
        ? 'docs/operations/runbooks/telegram.md#check-failing'
        : 'docs/operations-console/integrations.md#what-each-row-proves',
  }
  const evidence = item.evidence
  const add = (priority: number | null, text: string) =>
    problemFact(
      ctx,
      { ...base, priority, metricAt: evidence.checkedAt },
      { text, at: evidence.checkedAt, time: 'checked' }
    )
  if (item.source === 'unavailable') {
    add(null, ctx.t('integrationUnreadable'))
    return
  }
  if (
    item.configuration !== 'configured' ||
    evidence.failure === 'in_progress' ||
    evidence.result === 'simulated'
  ) {
    ctx.limitations.add('integrations')
    return
  }
  if (evidence.result === 'failed') {
    const message =
      evidence.scope === 'provider_token_check'
        ? 'tokenFailed'
        : evidence.scope === 'provider_acceptance'
          ? 'acceptanceFailed'
          : 'integrationFailed'
    add(1, ctx.t(message))
    if (evidence.freshness === 'stale') add(null, ctx.t('old'))
    return
  }
  if (evidence.result === 'unknown') {
    add(null, ctx.t('integrationUnknown'))
    return
  }
  const expected = !['configuration_only', 'provider_acceptance'].includes(evidence.scope)
  if (
    expected &&
    ((evidence.result === 'ok' && evidence.freshness === 'stale') ||
      (evidence.result === 'none' &&
        (evidence.scope === 'provider_token_check' || evidence.staleAfterSeconds !== null)))
  ) {
    add(null, ctx.t('integrationMissing'))
    return
  }
  if (
    evidence.result === 'none' ||
    evidence.scope === 'configuration_only' ||
    evidence.freshness === 'stale'
  )
    ctx.limitations.add('integrations')
}
