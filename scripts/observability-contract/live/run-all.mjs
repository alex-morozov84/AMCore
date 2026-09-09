#!/usr/bin/env node
// AMCore observability contract — live-tier entrypoint. Waits for the real
// stack to be scraping, then runs every live check and reports every
// violation before exiting non-zero. `run-live.sh` owns compose lifecycle
// and calls this once the stack is up.
import { waitUntilReady } from './lifecycle.mjs'
import { areTargetsUp, checkTargets } from './targets.mjs'
import { areRulesEvaluated, checkRuleGroups } from './rules.mjs'
import { checkAlertmanagerDiscovery } from './alertmanager.mjs'
import { checkMetricReferences, checkQueryEvaluability } from './query.mjs'
import {
  checkDashboardDrift,
  checkDatasourceHealth,
  checkGrafanaDsQuery,
  checkModernApiVersion,
  isGrafanaReady,
} from './grafana.mjs'

const CHECKS = [
  ['scrape targets', checkTargets],
  ['rule groups', checkRuleGroups],
  ['alertmanager discovery', checkAlertmanagerDiscovery],
  ['metric references', checkMetricReferences],
  ['query evaluability', checkQueryEvaluability],
  ['grafana modern API version', checkModernApiVersion],
  ['grafana dashboard drift', checkDashboardDrift],
  ['grafana datasource health', checkDatasourceHealth],
  ['grafana ds/query round trip', checkGrafanaDsQuery],
]

async function main() {
  await waitUntilReady('amcore-api/amcore-worker scrape targets', areTargetsUp)
  // R1 fix: also wait for the default rule groups' first evaluation — a
  // scrape target can be "up" before Prometheus's own (independent)
  // evaluation_interval has completed even once, and checkRuleGroups()
  // asserting health:"ok" immediately after targets-up is a real race,
  // reproduced independently against a clean boot.
  await waitUntilReady('default rule groups evaluated at least once', areRulesEvaluated)
  // Grafana's container reaching "Started" doesn't mean its HTTP server is
  // ready — it can still be mid-migration, which resets in-flight
  // connections instead of returning a clean HTTP error (observed live,
  // PR #394: an unhandled `ECONNRESET` failed the whole run instead of a
  // reported violation).
  await waitUntilReady('grafana ready', isGrafanaReady)

  let anyViolation = false
  for (const [label, check] of CHECKS) {
    const violations = await check()
    if (violations.length === 0) {
      console.log(`✔ ${label}`)
      continue
    }
    anyViolation = true
    console.log(`✖ ${label} (${violations.length}):`)
    for (const v of violations) console.log(`  - ${v}`)
  }

  if (anyViolation) {
    console.error('\nobservability contract (live): FAILED')
    process.exit(1)
  }
  console.log('\nobservability contract (live): all checks passed')
}

main().catch((err) => {
  console.error('observability contract (live): unexpected error\n', err)
  process.exit(1)
})
