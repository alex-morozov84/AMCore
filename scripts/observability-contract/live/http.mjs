// AMCore observability contract — tiny JSON-fetch helper shared by every
// live check module. Base URLs come from env vars so CI and a local run use
// the same code against different host ports if ever needed.
export const PROMETHEUS_URL = process.env.OBS_CONTRACT_PROMETHEUS_URL ?? 'http://127.0.0.1:9090'
export const ALERTMANAGER_URL = process.env.OBS_CONTRACT_ALERTMANAGER_URL ?? 'http://127.0.0.1:9093'
export const GRAFANA_URL = process.env.OBS_CONTRACT_GRAFANA_URL ?? 'http://127.0.0.1:3001'
export const GRAFANA_AUTH = {
  Authorization:
    'Basic ' +
    Buffer.from(`admin:${process.env.GF_SECURITY_ADMIN_PASSWORD ?? ''}`).toString('base64'),
}

export async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers })
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}

export async function postJson(url, payload, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: payload,
  })
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}
