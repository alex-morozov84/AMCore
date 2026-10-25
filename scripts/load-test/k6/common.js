// Shared settings for the load-test k6 scripts (docs/operations/load-testing.md).
// Inputs come from run-step.sh as environment variables; nothing here is product-specific.
// Visitors use the benchmark range 198.18.0.0/15, accepted only on the :8443 test entry.
export const WEB_HOST = __ENV.LT_WEB_HOST
export const API_HOST = __ENV.LT_API_HOST
const SERVER_IP = __ENV.LT_SERVER_IP
export const PREFIX = __ENV.LT_PREFIX ?? '' // '/en' with locale routing, '' without
if (!WEB_HOST || !API_HOST || !SERVER_IP)
  throw new Error('LT_WEB_HOST, LT_API_HOST and LT_SERVER_IP are required')

export const WEB = `https://${WEB_HOST}:8443`
export const API = `https://${API_HOST}:8443/api/v1`
export const ORIGIN = `https://${WEB_HOST}`
export const VISITORS = 200
export const ORG_ADMINS = 20 // members 1–20 hold the organization ADMIN role
export const OWNER_EMAIL = 'lt-owner@example.test'

// Pin both names to the host: a stale resolver cache must not send a run elsewhere.
export const HOSTS = { [WEB_HOST]: SERVER_IP, [API_HOST]: SERVER_IP }

// Member visitor i (0-based) owns account lt-member-(i+1) and one fixed address.
export const memberEmail = (i) => `lt-member-${String(i + 1).padStart(3, '0')}@example.test`
export const memberIp = (i) => `198.18.0.${i + 1}`
// Anonymous visitors use their own range, so they never share a member's budget.
export const anonymousIp = (i) => `198.18.1.${i + 1}`
export const ADMIN_IP = '198.18.2.1'

export const PASSWORD = open('/work/fixture-password').trim()
export const tlsAuth = [
  { domains: [WEB_HOST, API_HOST], cert: open('/work/client.crt'), key: open('/work/client.key') },
]
