// AMCore observability contract — live rule-group inventory (item 4, part 2):
// exactly the 8 default groups load, and the optional SLO groups genuinely
// do not (proving prometheus.yml's non-recursive rule_files glob live, not
// only by reading the config).
import { getJson, PROMETHEUS_URL } from './http.mjs'
import { extractRuleFiles } from '../extract/yaml-rules.mjs'

const DEFAULT_RULE_FILE = ['docs/operations/prometheus/amcore-alerts.yml']

function expectedDefaultGroupNames() {
  return extractRuleFiles(DEFAULT_RULE_FILE).groupNames
}

/**
 * R1 fix: readiness must wait until every default-group rule has completed
 * at least one evaluation (`health` is no longer `"unknown"`) before
 * `checkRuleGroups` asserts `health === "ok"` — otherwise a rule caught
 * between boot and its first evaluation reads as a false failure, not
 * "not ready yet". A genuinely unhealthy rule still fails once evaluated.
 */
export async function areRulesEvaluated() {
  const { body } = await getJson(`${PROMETHEUS_URL}/api/v1/rules`)
  const liveGroups = body?.data?.groups ?? []
  const expected = expectedDefaultGroupNames()
  if (!expected.every((name) => liveGroups.some((g) => g.name === name))) return false
  return liveGroups
    .filter((g) => expected.includes(g.name))
    .every((g) => g.rules.every((r) => r.health !== 'unknown'))
}

export async function checkRuleGroups() {
  const { body } = await getJson(`${PROMETHEUS_URL}/api/v1/rules`)
  const liveGroups = body?.data?.groups ?? []
  const liveGroupNames = new Set(liveGroups.map((g) => g.name))
  const expectedDefault = new Set(expectedDefaultGroupNames())

  const violations = []
  // R3 fix: the inventory must be exact — flag both a missing expected group
  // and any group present that isn't expected (the optional SLO groups
  // included, but not only them; any other unexpected group too).
  for (const name of expectedDefault) {
    if (!liveGroupNames.has(name)) violations.push(`expected default group "${name}" is not loaded`)
  }
  for (const name of liveGroupNames) {
    if (!expectedDefault.has(name)) violations.push(`unexpected rule group "${name}" is loaded`)
  }
  for (const group of liveGroups) {
    if (!expectedDefault.has(group.name)) continue
    for (const rule of group.rules) {
      if (rule.health !== 'ok') {
        violations.push(
          `rule "${rule.name}" in group "${group.name}" has health "${rule.health}", expected "ok"`
        )
      }
    }
  }
  return violations
}
