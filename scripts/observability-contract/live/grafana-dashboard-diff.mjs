// AMCore observability contract — diffs the live-provisioned dashboard
// (classic v1 schema) against the committed dashboard JSON.
import { buildDashboardModel, extractDashboardModel } from '../extract/dashboard.mjs'
import { fetchDashboardDto } from './grafana-dto.mjs'

const COMMITTED_DASHBOARD_PATH = 'docker/monitoring/grafana/dashboards/amcore-overview.json'

function diffTarget(panelTitle, k, target, liveTarget, violations) {
  if (target.expr !== liveTarget.expr) {
    violations.push(`panel "${panelTitle}" target ${k}: expr differs from provisioned dashboard`)
  }
  if (target.datasource?.uid !== liveTarget.datasource?.uid) {
    violations.push(
      `panel "${panelTitle}" target ${k}: datasource uid differs from provisioned dashboard`
    )
  }
  if (target.datasource?.type !== liveTarget.datasource?.type) {
    violations.push(
      `panel "${panelTitle}" target ${k}: datasource type "${target.datasource?.type}" != live "${liveTarget.datasource?.type}"`
    )
  }
}

function diffPanelTargets(panel, livePanel, violations) {
  // R4 fix: an extra live-provisioned target was previously invisible —
  // forEach over the committed side alone never notices livePanel.targets
  // being longer. Check both directions.
  if (panel.targets.length !== livePanel.targets.length) {
    violations.push(
      `panel "${panel.title}": target count differs (committed ${panel.targets.length}, live ${livePanel.targets.length})`
    )
    return
  }
  panel.targets.forEach((target, k) =>
    diffTarget(panel.title, k, target, livePanel.targets[k], violations)
  )
}

function diffPanel(rowTitle, panel, livePanel, violations) {
  if (panel.title !== livePanel.title) {
    violations.push(`row "${rowTitle}": panel title "${panel.title}" != live "${livePanel.title}"`)
    return
  }
  if (panel.id !== livePanel.id) {
    violations.push(`panel "${panel.title}": id ${panel.id} != live id ${livePanel.id}`)
  }
  diffPanelTargets(panel, livePanel, violations)
}

function diffRow(row, liveRow, i, violations) {
  if (row.title !== liveRow.title) {
    violations.push(`row ${i}: title "${row.title}" != live "${liveRow.title}"`)
    return
  }
  if (row.panels.length !== liveRow.panels.length) {
    violations.push(
      `row "${row.title}": panel count differs (committed ${row.panels.length}, live ${liveRow.panels.length})`
    )
    return
  }
  row.panels.forEach((panel, j) => diffPanel(row.title, panel, liveRow.panels[j], violations))
}

export function diffDashboardModels(committed, live) {
  const violations = []
  if (committed.rows.length !== live.rows.length) {
    violations.push(
      `row count differs: committed ${committed.rows.length}, live ${live.rows.length}`
    )
    return violations
  }
  committed.rows.forEach((row, i) => diffRow(row, live.rows[i], i, violations))
  return violations
}

/** Diffs the live-provisioned dashboard (classic v1 schema) against the committed JSON. */
export async function checkDashboardDrift() {
  const { status, body } = await fetchDashboardDto('v1')
  if (status !== 200) return [`GET dashboard dto at v1 returned HTTP ${status}`]
  const liveModel = buildDashboardModel(body.spec.panels, 'live dashboard')
  const committedModel = extractDashboardModel(COMMITTED_DASHBOARD_PATH)
  return diffDashboardModels(committedModel, liveModel)
}
