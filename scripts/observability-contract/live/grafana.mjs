// AMCore observability contract — Grafana checks (item 3): modern API
// version selection, provisioned-vs-committed dashboard drift, datasource
// health, and a real Grafana->Prometheus query round trip.
import { getJson, GRAFANA_URL, GRAFANA_AUTH } from './http.mjs'
import { buildDashboardModel, extractDashboardModel } from '../extract/dashboard.mjs'

const DASHBOARD_UID = 'amcore-overview'
const DATASOURCE_UID = 'amcore-prometheus'
const COMMITTED_DASHBOARD_PATH = 'docker/monitoring/grafana/dashboards/amcore-overview.json'

/** Discovers the dashboard API group's preferred version (e.g. "v2" today). */
export async function discoverPreferredDashboardVersion() {
  const { body } = await getJson(`${GRAFANA_URL}/apis/dashboard.grafana.app`, GRAFANA_AUTH)
  const preferred = body?.preferredVersion
  if (!preferred?.version || !preferred?.groupVersion) {
    throw new Error(
      `dashboard.grafana.app discovery document has no preferredVersion: ${JSON.stringify(body)}`
    )
  }
  return preferred
}

/** Fetches the dashboard DTO at a given API version. */
async function fetchDashboardDto(version) {
  return getJson(
    `${GRAFANA_URL}/apis/dashboard.grafana.app/${version}/namespaces/default/dashboards/${DASHBOARD_UID}/dto`,
    GRAFANA_AUTH
  )
}

/** Confirms the modern (preferred-version) API surface works and self-reports the right version. */
export async function checkModernApiVersion() {
  const preferred = await discoverPreferredDashboardVersion()
  const { status, body } = await fetchDashboardDto(preferred.version)
  if (status !== 200) return [`GET dashboard dto at ${preferred.version} returned HTTP ${status}`]
  if (body?.apiVersion !== preferred.groupVersion) {
    return [
      `dashboard dto apiVersion "${body?.apiVersion}" does not match discovered preferredVersion.groupVersion "${preferred.groupVersion}"`,
    ]
  }
  return []
}

export function diffDashboardModels(committed, live) {
  const violations = []
  if (committed.rows.length !== live.rows.length) {
    violations.push(
      `row count differs: committed ${committed.rows.length}, live ${live.rows.length}`
    )
    return violations
  }
  committed.rows.forEach((row, i) => {
    const liveRow = live.rows[i]
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
  })
  return violations
}

function diffPanel(rowTitle, panel, livePanel, violations) {
  if (panel.title !== livePanel.title) {
    violations.push(`row "${rowTitle}": panel title "${panel.title}" != live "${livePanel.title}"`)
    return
  }
  panel.targets.forEach((target, k) => {
    const liveTarget = livePanel.targets[k]
    if (!liveTarget) {
      violations.push(`panel "${panel.title}": missing live target ${k}`)
      return
    }
    if (target.expr !== liveTarget.expr) {
      violations.push(`panel "${panel.title}" target ${k}: expr differs from provisioned dashboard`)
    }
    if (target.datasource?.uid !== liveTarget.datasource?.uid) {
      violations.push(
        `panel "${panel.title}" target ${k}: datasource uid differs from provisioned dashboard`
      )
    }
  })
}

/** Diffs the live-provisioned dashboard (classic v1 schema) against the committed JSON. */
export async function checkDashboardDrift() {
  const { status, body } = await fetchDashboardDto('v1')
  if (status !== 200) return [`GET dashboard dto at v1 returned HTTP ${status}`]
  const liveModel = buildDashboardModel(body.spec.panels, 'live dashboard')
  const committedModel = extractDashboardModel(COMMITTED_DASHBOARD_PATH)
  return diffDashboardModels(committedModel, liveModel)
}

export async function checkDatasourceHealth() {
  const { body } = await getJson(
    `${GRAFANA_URL}/api/datasources/uid/${DATASOURCE_UID}/health`,
    GRAFANA_AUTH
  )
  if (body?.status !== 'OK')
    return [`datasource health is "${body?.status}", expected "OK": ${body?.message}`]
  return []
}

/** A real Grafana -> Prometheus query round trip for the build-info target. */
export async function checkGrafanaDsQuery() {
  const now = Date.now()
  const payload = JSON.stringify({
    queries: [
      {
        refId: 'A',
        datasource: { type: 'prometheus', uid: DATASOURCE_UID },
        expr: 'amcore_build_info',
        instant: true,
        intervalMs: 15000,
        maxDataPoints: 100,
      },
    ],
    from: String(now - 5 * 60 * 1000),
    to: String(now),
  })
  const response = await fetch(`${GRAFANA_URL}/api/ds/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...GRAFANA_AUTH },
    body: payload,
  })
  const body = await response.json().catch(() => null)
  const result = body?.results?.A
  if (!result || result.error) {
    return [
      `Grafana ds/query for amcore_build_info returned an error: ${JSON.stringify(result?.error)}`,
    ]
  }
  const hasData = (result.frames ?? []).some((f) =>
    (f.data?.values ?? []).some((col) => col.length > 0)
  )
  if (!hasData) return ['Grafana ds/query for amcore_build_info returned no data in any frame']
  return []
}
