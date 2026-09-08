// AMCore observability contract — live Alertmanager discovery (item 4, part 3).
import { getJson, PROMETHEUS_URL } from './http.mjs'

const EXPECTED_URL_FRAGMENT = 'alertmanager:9093'

export async function isAlertmanagerDiscovered() {
  const { body } = await getJson(`${PROMETHEUS_URL}/api/v1/alertmanagers`)
  const active = body?.data?.activeAlertmanagers ?? []
  return active.some((a) => a.url?.includes(EXPECTED_URL_FRAGMENT))
}

export async function checkAlertmanagerDiscovery() {
  const { body } = await getJson(`${PROMETHEUS_URL}/api/v1/alertmanagers`)
  const active = body?.data?.activeAlertmanagers ?? []
  if (!active.some((a) => a.url?.includes(EXPECTED_URL_FRAGMENT))) {
    return [
      `no active Alertmanager matching "${EXPECTED_URL_FRAGMENT}" ` +
        `(active: ${JSON.stringify(active.map((a) => a.url))})`,
    ]
  }
  return []
}
