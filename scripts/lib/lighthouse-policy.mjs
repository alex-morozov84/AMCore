import { assertRequiredAudits } from './lighthouse-required.mjs'
import defaultConfig from 'lighthouse/core/config/default-config.js'
import { invariant } from './lighthouse-plan.mjs'

const categories = ['performance', 'accessibility', 'best-practices', 'seo']
const metrics = {
  'first-contentful-paint': 'millisecond',
  'largest-contentful-paint': 'millisecond',
  'total-blocking-time': 'millisecond',
  'cumulative-layout-shift': 'unitless',
}
export function validateResult(lhr) {
  invariant(lhr?.lighthouseVersion === '13.6.0' && !lhr.runtimeError, 'invalid-engine-result')
  for (const key of categories) {
    const category = lhr.categories?.[key]
    invariant(
      category &&
        (category.score === null ||
          (Number.isFinite(category.score) && category.score >= 0 && category.score <= 1)),
      'invalid-category'
    )
    const expected = defaultConfig.categories[key].auditRefs
      .map((r) => r.id)
      .filter((id) => !(key === 'performance' && id === 'interaction-to-next-paint'))
    invariant(
      JSON.stringify(category.auditRefs?.map((r) => r.id)) === JSON.stringify(expected),
      'changed-audit-inventory'
    )
    invariant(
      category.auditRefs.every((r) => lhr.audits?.[r.id]),
      'missing-referenced-audit'
    )
  }
  for (const [id, audit] of Object.entries(lhr.audits)) {
    invariant(audit.id === id && !audit.errorMessage, 'invalid-audit-identity-or-error')
    const mode = audit.scoreDisplayMode
    if (['binary', 'numeric', 'metricSavings'].includes(mode))
      invariant(
        Number.isFinite(audit.score) &&
          audit.score >= 0 &&
          audit.score <= 1 &&
          (mode !== 'binary' || [0, 1].includes(audit.score)),
        'invalid-audit-score'
      )
    else if (mode === 'informative') invariant(audit.score === 1, 'invalid-informative-audit')
    else
      invariant(
        ['manual', 'notApplicable'].includes(mode) && audit.score === null,
        'unknown-or-error-audit-mode'
      )
  }
  for (const [id, unit] of Object.entries(metrics))
    invariant(
      Number.isFinite(lhr.audits[id]?.numericValue) &&
        lhr.audits[id].numericValue >= 0 &&
        lhr.audits[id].numericUnit === unit,
      'invalid-metric'
    )
}

export function evaluateResult(lhr, scenario, observation) {
  assertRequiredAudits(scenario.requiredAudits)
  validateResult(lhr)
  invariant(
    observation.identity && observation.requiredData && observation.url === lhr.finalDisplayedUrl,
    'unverified-measured-state'
  )
  const failed = [],
    manual = [],
    notApplicable = []
  for (const request of lhr.audits['network-requests']?.details?.items ?? []) {
    const path = new URL(request.url).pathname
    const refusal = scenario.id === 'login' && path === '/api/auth/me' && request.statusCode === 401
    invariant(
      !(path.startsWith('/api/') && request.statusCode >= 400 && !refusal),
      'required-data-refused'
    )
    if (
      ['Document', 'Script', 'Stylesheet', 'Font', 'Image'].includes(request.resourceType) &&
      (request.statusCode === 0 || request.statusCode >= 400)
    )
      failed.push('failed-resource')
  }
  for (const { id } of lhr.categories.accessibility.auditRefs) {
    const a = lhr.audits[id]
    if (a.scoreDisplayMode === 'manual') manual.push(id)
    else if (a.scoreDisplayMode === 'notApplicable') notApplicable.push(id)
    else if (a.scoreDisplayMode !== 'informative' && a.score < 1) failed.push(id)
  }
  for (const id of scenario.requiredAudits) {
    invariant(lhr.audits[id], 'missing-required-audit')
    const audit = lhr.audits[id]
    if (['manual', 'informative', 'notApplicable'].includes(audit.scoreDisplayMode))
      failed.push(`${id}:unexpected-applicability`)
    else {
      invariant(audit.scoreDisplayMode === 'binary', 'unsupported-required-audit-mode')
      if (audit.score !== 1 && !failed.includes(id)) failed.push(id)
    }
  }
  if (observation.indexable !== scenario.indexable) failed.push('indexing-expectation')
  return {
    passed: failed.length === 0,
    failed,
    manual,
    notApplicable,
    scores: Object.fromEntries(categories.map((id) => [id, lhr.categories[id].score])),
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([id, unit]) => [
        id,
        { value: lhr.audits[id].numericValue, unit },
      ])
    ),
  }
}
