// AMCore observability contract — dashboard model integrity: every panel's
// datasource matches the provisioned one (static half of the datasource-UID
// mutation proof), and every runbook citation names a real (row, panel) pair.
import { readFileSync } from 'node:fs'

import { extractDashboardModel, flattenPanels } from './extract/dashboard.mjs'
import { extractPanelCitations } from './extract/runbook.mjs'

/** @returns {string[]} violation messages for panels/targets whose datasource doesn't match `expectedUid`. */
export function validateDatasourceConsistency(model, expectedUid) {
  const violations = []
  for (const row of model.rows) {
    for (const panel of row.panels) {
      for (const target of panel.targets) {
        const { type, uid } = target.datasource ?? {}
        if (type !== 'prometheus' || uid !== expectedUid) {
          violations.push(
            `panel "${panel.title}" (${row.title} row): target datasource is ` +
              `${JSON.stringify(target.datasource)}, expected {type:"prometheus", uid:${JSON.stringify(expectedUid)}}`
          )
        }
      }
    }
  }
  return violations
}

/**
 * @param {{panel:string, row:string|null, file:string, line:number}[]} citations
 * @param {{row:string, panel:string}[]} realPairs
 * @returns {string[]} violation messages
 */
export function validatePanelCitations(citations, realPairs) {
  const valid = new Set(realPairs.map((p) => `${p.row}|||${p.panel}`))
  const violations = []
  for (const c of citations) {
    if (c.row === null) {
      violations.push(`${c.file}:${c.line}: "${c.panel}" is cited without a row`)
    } else if (!valid.has(`${c.row}|||${c.panel}`)) {
      violations.push(
        `${c.file}:${c.line}: "${c.panel}" (${c.row} row) is not a real dashboard panel`
      )
    }
  }
  return violations
}

export function readProvisionedDatasourceUid(provisioningYamlPath) {
  const text = readFileSync(provisioningYamlPath, 'utf8')
  const match = /^\s*uid:\s*(\S+)\s*$/m.exec(text)
  if (!match) throw new Error(`${provisioningYamlPath}: no "uid:" field found`)
  return match[1]
}

export function runAgainstRealRepo({
  dashboardPath = 'docker/monitoring/grafana/dashboards/amcore-overview.json',
  provisioningPath = 'docker/monitoring/grafana/provisioning/datasources/prometheus.yml',
  runbookPaths = [
    'docs/operations/runbooks/http.md',
    'docs/operations/runbooks/db.md',
    'docs/operations/runbooks/redis.md',
    'docs/operations/runbooks/queues.md',
    'docs/operations/runbooks/email.md',
    'docs/operations/runbooks/realtime.md',
    'docs/operations/runbooks/node-runtime.md',
    'docs/operations/runbooks/metrics-collector-health.md',
  ],
} = {}) {
  const model = extractDashboardModel(dashboardPath)
  const uid = readProvisionedDatasourceUid(provisioningPath)
  const datasourceViolations = validateDatasourceConsistency(model, uid)

  const realPairs = flattenPanels(model)
  const citations = runbookPaths.flatMap((p) => extractPanelCitations(p))
  const citationViolations = validatePanelCitations(citations, realPairs)

  return [...datasourceViolations, ...citationViolations]
}
