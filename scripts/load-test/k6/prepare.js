// One-time preparation: each member signs in through the web app from its own address and
// reads its organization-context binding, as a browser does. Writes /work/sessions.json.
// Logins are paced so no member exceeds the ordinary sign-in limits.
import { sleep } from 'k6'
import http from 'k6/http'

import { HOSTS, memberEmail, memberIp, ORIGIN, PASSWORD, tlsAuth, VISITORS, WEB } from './common.js'

export const options = {
  tlsAuth,
  hosts: HOSTS,
  setupTimeout: '15m',
  scenarios: { prepare: { executor: 'shared-iterations', vus: 1, iterations: 1 } },
}

export default function () {}

const headers = (i, extra = {}) => ({ origin: ORIGIN, 'x-forwarded-for': memberIp(i), ...extra })

export function setup() {
  const sessions = []
  const bindings = []
  let orgId
  for (let i = 0; i < VISITORS; i++) {
    const login = http.post(
      `${WEB}/api/auth/login`,
      JSON.stringify({ email: memberEmail(i), password: PASSWORD }),
      {
        headers: headers(i, { 'content-type': 'application/json' }),
        redirects: 0,
      }
    )
    const cookie = login.cookies.amcore_session?.[0]?.value
    if (login.status !== 200 || !cookie)
      throw new Error(`member ${i + 1}: sign-in answered ${login.status}`)
    const boot = http.get(`${WEB}/api/product-access/bootstrap`, {
      headers: headers(i),
      cookies: { amcore_session: cookie },
    })
    const binding = boot.status === 200 ? boot.json('binding') : undefined
    if (typeof binding !== 'string' || boot.json('actor.email') !== memberEmail(i))
      throw new Error(`member ${i + 1}: bootstrap answered ${boot.status} without its binding`)
    // Every member must see exactly the one load-test organization.
    const orgs = http.get(`${WEB}/api/product-access/organizations`, {
      headers: headers(i, { 'x-amcore-context-session': binding }),
      cookies: { amcore_session: cookie },
    })
    const items = orgs.status === 200 ? orgs.json('data.data') : undefined
    const id =
      Array.isArray(items) && items.length === 1 && items[0].slug.startsWith('lt-')
        ? items[0].id
        : undefined
    if (!id || (orgId && id !== orgId))
      throw new Error(
        `member ${i + 1}: organization list answered ${orgs.status} without the load-test organization`
      )
    orgId = id
    sessions.push(cookie)
    bindings.push(binding)
    sleep(0.2)
  }
  return { sessions, bindings, orgId }
}

// Written only when every member is prepared, so a failed run leaves nothing to reuse.
export function handleSummary(data) {
  const ready = data.setup_data?.sessions?.length === VISITORS
  return ready ? { '/work/sessions.json': JSON.stringify(data.setup_data) } : {}
}
