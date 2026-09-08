// AMCore observability contract — structural extraction of every PromQL
// expression this repository ships (alerts, dashboard panel targets, tagged
// runbook fences). Only checks that YAML/JSON parses and every rule/target
// has a non-empty `expr` — real PromQL syntax/evaluability is a live-tier
// concern (needs a real Prometheus; see live/query.mjs). Tier 2 imports
// `getAllExpressions` directly rather than reading a Tier 1 output file, so
// both tiers derive the same list independently from the same source files.
import { extractRuleFiles } from './extract/yaml-rules.mjs'
import { extractDashboardModel, flattenTargetExpressions } from './extract/dashboard.mjs'
import { extractPromqlFences } from './extract/runbook.mjs'

const RULE_FILES = [
  'docs/operations/prometheus/amcore-alerts.yml',
  'docs/operations/prometheus/optional/amcore-slo-burn-rate.yml',
]
const DASHBOARD_PATH = 'docker/monitoring/grafana/dashboards/amcore-overview.json'
const RUNBOOK_PATHS = [
  'docs/operations/runbooks/http.md',
  'docs/operations/runbooks/db.md',
  'docs/operations/runbooks/redis.md',
  'docs/operations/runbooks/queues.md',
  'docs/operations/runbooks/email.md',
  'docs/operations/runbooks/realtime.md',
  'docs/operations/runbooks/node-runtime.md',
  'docs/operations/runbooks/metrics-collector-health.md',
]

/** Every PromQL expression this repo ships, each `{ expr, file, line, label }`. */
export function getAllExpressions() {
  const { alertingRules, recordingRules } = extractRuleFiles(RULE_FILES)
  const dashboardModel = extractDashboardModel(DASHBOARD_PATH)
  const runbookExprs = RUNBOOK_PATHS.flatMap((p) => extractPromqlFences(p))

  return [
    ...alertingRules.map((r) => ({
      expr: r.expr,
      file: r.file,
      line: r.line,
      label: `alert ${r.alertName}`,
    })),
    ...recordingRules.map((r) => ({
      expr: r.expr,
      file: r.file,
      line: r.line,
      label: `record ${r.recordName}`,
    })),
    ...flattenTargetExpressions(dashboardModel, DASHBOARD_PATH).map((e) => ({
      ...e,
      label: e.label,
    })),
    ...runbookExprs.map((r) => ({
      expr: r.expr,
      file: r.file,
      line: r.line,
      label: 'runbook query',
    })),
  ]
}

/** @returns {string[]} recording rule names declared by record: fields (one source of truth). */
export function getRecordingRuleNames() {
  return extractRuleFiles(RULE_FILES).recordingRules.map((r) => r.recordName)
}

export function validateEveryExpressionIsNonEmpty(expressions) {
  return expressions
    .filter((e) => !e.expr || !e.expr.trim())
    .map((e) => `${e.file}:${e.line}: ${e.label} has an empty expr`)
}

export function runAgainstRealRepo() {
  return validateEveryExpressionIsNonEmpty(getAllExpressions())
}
