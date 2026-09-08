// AMCore observability contract — the metric-reference guard (item 1, live-
// sourced per B4/V3.1) and query evaluability (item 2).
import { getJson, postJson, PROMETHEUS_URL } from './http.mjs'
import { getAllExpressions, getRecordingRuleNames } from '../validate-expression-extraction.mjs'

const TARGET_MATCH = '{job=~"amcore-(api|worker)"}'

/** Builds the allowed metric-name set from what the two real targets expose. */
export async function buildAllowedMetricNames() {
  const { body } = await getJson(
    `${PROMETHEUS_URL}/api/v1/targets/metadata?match_target=${encodeURIComponent(TARGET_MATCH)}`
  )
  const entries = body?.data ?? []
  const jobsSeen = new Set(entries.map((e) => e.target?.job))
  const names = new Set(['up'])
  for (const e of entries) {
    if (e.type === 'histogram') {
      names.add(`${e.metric}_bucket`)
      names.add(`${e.metric}_sum`)
      names.add(`${e.metric}_count`)
    } else {
      names.add(e.metric)
    }
  }
  for (const name of getRecordingRuleNames()) names.add(name)
  return { names, jobsSeen }
}

const SELECTOR_TYPES = new Set(['vectorSelector', 'matrixSelector'])

/**
 * Recursively collects every metric-selector name from a parse_query AST
 * node. Both a bare selector (`up`) and a range selector wrapped in
 * `rate(...[5m])` carry the metric name directly on `.name` — verified
 * against the real pinned Prometheus, not assumed from the (experimental,
 * UI-only) endpoint's docs alone.
 */
export function collectVectorSelectorNames(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (SELECTOR_TYPES.has(node.type) && node.name) out.push(node.name)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((v) => collectVectorSelectorNames(v, out))
    else if (value && typeof value === 'object') collectVectorSelectorNames(value, out)
  }
  return out
}

/**
 * Checks one expression's metric references. A parse failure (bad HTTP
 * status, missing/non-JSON body, or the API's own status:"error") is itself
 * a violation — silently treating it as "no selectors found" would disable
 * this guard for that expression rather than flag it (verified: this is
 * exactly what happened before this check existed, confirmed by mocking an
 * error response).
 */
async function checkExpressionMetricReferences({ expr, file, line, label }, names) {
  const { status, body } = await postJson(
    `${PROMETHEUS_URL}/api/v1/parse_query`,
    `query=${encodeURIComponent(expr)}`
  )
  if (status < 200 || status >= 300 || body?.status !== 'success' || !body?.data) {
    return [
      `${file}:${line}: ${label} — parse_query failed (HTTP ${status}, ` +
        `status "${body?.status}"${body?.error ? `: ${body.error}` : ''}) — cannot verify its metric references`,
    ]
  }
  return collectVectorSelectorNames(body.data)
    .filter((name) => !names.has(name))
    .map((name) => `${file}:${line}: ${label} references unknown metric "${name}"`)
}

export async function checkMetricReferences() {
  const { names, jobsSeen } = await buildAllowedMetricNames()
  const violations = []
  for (const job of ['amcore-api', 'amcore-worker']) {
    if (!jobsSeen.has(job)) violations.push(`no metadata returned for target job "${job}"`)
  }
  for (const expression of getAllExpressions()) {
    violations.push(...(await checkExpressionMetricReferences(expression, names)))
  }
  return violations
}

export async function checkQueryEvaluability() {
  const violations = []
  for (const { expr, file, line, label } of getAllExpressions()) {
    const { body } = await postJson(
      `${PROMETHEUS_URL}/api/v1/query`,
      `query=${encodeURIComponent(expr)}`
    )
    if (body?.status !== 'success') {
      violations.push(
        `${file}:${line}: ${label} failed to evaluate — ${body?.errorType}: ${body?.error}`
      )
    }
  }
  return violations
}
