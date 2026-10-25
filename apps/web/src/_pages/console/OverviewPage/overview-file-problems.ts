import type { AdminOverviewResponse, IntegrationItem } from '@amcore/shared'

import {
  getConsoleIntegrationsHref,
  getConsoleOverviewHref,
} from '@/shared/lib/console-public-href'

import { type ProblemContext, type ProblemFact, problemFact } from './overview-problem-model'

export function fileProblems(
  ctx: ProblemContext,
  data: AdminOverviewResponse | null,
  secondary?: IntegrationItem
) {
  const base = {
    key: 'files',
    source: 'overview' as const,
    name: ctx.t('files'),
    href: data
      ? `${getConsoleOverviewHref()}#overview-files`
      : `${getConsoleIntegrationsHref()}?focus=storage`,
    action: data ? ('openFiles' as const) : ('openIntegration' as const),
  }
  const add = (priority: number | null, anchor: string, fact: ProblemFact) =>
    problemFact(
      ctx,
      {
        ...base,
        priority,
        guide: `docs/operations/runbooks/storage.md#${anchor}`,
        metricAt: fact.at,
      },
      fact
    )
  if (data) {
    const pub = data.publicDelivery
    const storage = data.storage
    if (pub.failure === 'private_exposed')
      add(0, 'private-exposure', { text: ctx.t('exposure'), at: pub.checkedAt, time: 'checked' })
    else if (pub.state !== 'off' && (pub.state === 'failed' || pub.failure))
      add(1, 'public-delivery', { text: ctx.t('publicFailed'), at: pub.checkedAt, time: 'checked' })
    else if (pub.state === 'stale' || pub.state === 'unknown')
      add(null, 'public-delivery', {
        text: ctx.t('publicUnknown'),
        at: pub.checkedAt,
        time: 'checked',
      })
    if (storage.state === 'failed' || storage.failure)
      add(1, 'file-diagnostic', {
        text: ctx.t('privateFailed'),
        at: storage.checkedAt,
        time: 'checked',
      })
    else if (storage.state === 'stale' || storage.state === 'unknown')
      add(null, 'file-diagnostic', {
        text: ctx.t('filesUnknown'),
        at: storage.checkedAt,
        time: 'checked',
      })
    if (pub.state === 'stale' || storage.state === 'stale')
      add(null, 'file-diagnostic', { text: ctx.t('old') })
    if (data.storageHealthEnabled) {
      const dependency = data.dependencies.find((item) => item.name === 'storage')
      if (!dependency || dependency.status !== 'up') {
        const state = dependency?.status ?? 'unknown'
        add(state === 'down' ? 1 : state === 'degraded' ? 2 : null, 'file-diagnostic', {
          text: ctx.t(
            state === 'down'
              ? 'dependencyDown'
              : state === 'degraded'
                ? 'dependencyDegraded'
                : 'dependencyUnknown',
            { name: ctx.t('files') }
          ),
          at: data.checkedAt,
          time: 'checked',
        })
      }
    }
  }
  if (!secondary) return
  const evidence = secondary.evidence
  if (secondary.source === 'unavailable') {
    if (!data) add(null, 'file-diagnostic', { text: ctx.t('integrationUnreadable') })
    return
  }
  if (data) {
    const primaryFailed = data.storage.state === 'failed' || data.storage.failure !== null
    const different =
      evidence.result === 'failed'
        ? !primaryFailed || evidence.failure !== data.storage.failure
        : evidence.result === 'ok'
          ? primaryFailed
          : false
    if (different) {
      add(evidence.result === 'failed' ? 1 : null, 'file-diagnostic', {
        text: ctx.t('different'),
        at: evidence.checkedAt,
        time: 'checked',
      })
      add(null, 'file-diagnostic', {
        text: ctx.t(evidence.result === 'failed' ? 'privateFailed' : 'privatePassed'),
        at: evidence.checkedAt,
        time: 'checked',
      })
    }
    return
  }
  add(evidence.result === 'failed' ? 1 : null, 'file-diagnostic', {
    text: ctx.t(evidence.result === 'failed' ? 'privateFailed' : 'privateFallback'),
    at: evidence.checkedAt,
    time: 'checked',
  })
  add(null, 'file-diagnostic', { text: ctx.t('privateFallback') })
  if (evidence.result === 'ok')
    add(null, 'file-diagnostic', {
      text: ctx.t('privatePassed'),
      at: evidence.checkedAt,
      time: 'checked',
    })
  else if (evidence.result !== 'failed')
    add(null, 'file-diagnostic', {
      text: ctx.t('filesUnknown'),
      at: evidence.checkedAt,
      time: 'checked',
    })
  add(null, 'file-diagnostic', { text: ctx.t('publicMissing') })
  if (evidence.freshness === 'stale') add(null, 'file-diagnostic', { text: ctx.t('old') })
}
