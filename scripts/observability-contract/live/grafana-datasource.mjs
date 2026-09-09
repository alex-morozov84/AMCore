// AMCore observability contract — Grafana datasource health and a real
// Grafana -> Prometheus query round trip (the B3 mutation-proof fix: a
// bad-UID mutation must fail this, not just a static consistency check).
import { getJson, GRAFANA_URL, GRAFANA_AUTH } from './http.mjs'

export const DATASOURCE_UID = 'amcore-prometheus'

export async function checkDatasourceHealth() {
  const { body } = await getJson(
    `${GRAFANA_URL}/api/datasources/uid/${DATASOURCE_UID}/health`,
    GRAFANA_AUTH
  )
  if (body?.status !== 'OK')
    return [`datasource health is "${body?.status}", expected "OK": ${body?.message}`]
  return []
}

function buildDsQueryPayload() {
  const now = Date.now()
  return JSON.stringify({
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
}

function validateDsQueryResult(result) {
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

/** A real Grafana -> Prometheus query round trip for the build-info target. */
export async function checkGrafanaDsQuery() {
  const response = await fetch(`${GRAFANA_URL}/api/ds/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...GRAFANA_AUTH },
    body: buildDsQueryPayload(),
  })
  const body = await response.json().catch(() => null)
  return validateDsQueryResult(body?.results?.A)
}
