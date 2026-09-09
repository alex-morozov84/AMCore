// AMCore observability contract — Grafana dashboard DTO access shared by the
// modern-API-version check and the classic-schema structural diff.
import { getJson, GRAFANA_URL, GRAFANA_AUTH } from './http.mjs'

export const DASHBOARD_UID = 'amcore-overview'

/**
 * Grafana's container reaching "Started" doesn't mean its HTTP server is
 * accepting connections yet — it can still be running its own DB migrations,
 * during which a request gets `ECONNRESET` rather than a clean HTTP error.
 * `/api/health` is unauthenticated and only reports `database: "ok"` once
 * that's done, mirroring the Prometheus `waitUntilReady` gate this repo
 * already uses for scrape targets and rule evaluation.
 */
export async function isGrafanaReady() {
  const { status, body } = await getJson(`${GRAFANA_URL}/api/health`)
  return status === 200 && body?.database === 'ok'
}

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
export async function fetchDashboardDto(version) {
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
