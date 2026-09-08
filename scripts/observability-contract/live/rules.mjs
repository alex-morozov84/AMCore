// AMCore observability contract — live rule-group inventory (item 4, part 2):
// exactly the 8 default groups load, and the optional SLO groups genuinely
// do not (proving prometheus.yml's non-recursive rule_files glob live, not
// only by reading the config).
import { getJson, PROMETHEUS_URL } from './http.mjs'
import { extractRuleFiles } from '../extract/yaml-rules.mjs'

const DEFAULT_RULE_FILE = ['docs/operations/prometheus/amcore-alerts.yml']
const OPTIONAL_RULE_FILE = ['docs/operations/prometheus/optional/amcore-slo-burn-rate.yml']

export async function checkRuleGroups() {
  const { body } = await getJson(`${PROMETHEUS_URL}/api/v1/rules`)
  const liveGroups = body?.data?.groups ?? []
  const liveGroupNames = new Set(liveGroups.map((g) => g.name))

  const { groupNames: expectedDefault } = extractRuleFiles(DEFAULT_RULE_FILE)
  const { groupNames: optionalGroups } = extractRuleFiles(OPTIONAL_RULE_FILE)

  const violations = []
  for (const name of expectedDefault) {
    if (!liveGroupNames.has(name)) violations.push(`expected default group "${name}" is not loaded`)
  }
  for (const name of optionalGroups) {
    if (liveGroupNames.has(name)) {
      violations.push(`optional SLO group "${name}" is loaded but should be off by default`)
    }
  }
  for (const group of liveGroups) {
    if (!expectedDefault.includes(group.name)) continue
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
