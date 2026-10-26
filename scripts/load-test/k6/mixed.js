// One measured load step: open arrival model, RATE iterations/s for DURATION.
// Iteration k serves visitor k % 200; the action follows a fixed 20-slot cycle shifted per
// round, so every run keeps the planned mix (per 1,200 iterations: browse 780, public 180,
// notify 120, team 60, upload 60). A separate admin scenario reads two backend admin lists.
// "notify" writes the in-app notification synchronously; it is not a queue test.
import { check } from 'k6'
import exec from 'k6/execution'
import http from 'k6/http'

import {
  ADMIN_IP,
  anonymousIp,
  API,
  HOSTS,
  memberIp,
  ORG_ADMINS,
  ORIGIN,
  OWNER_EMAIL,
  PASSWORD,
  PREFIX,
  tlsAuth,
  VISITORS,
  WEB,
} from './common.js'

const RATE = Number(__ENV.LT_RATE ?? 5)
const DURATION = __ENV.LT_DURATION ?? '120s'
if (!/^[0-9]+s$/.test(DURATION) || !(RATE > 0))
  throw new Error('LT_DURATION must be <n>s and LT_RATE positive')
const ADMIN_RATE = Number(__ENV.LT_ADMIN_RATE ?? 0.2)
const SMOKE = __ENV.LT_SMOKE === '1'
const OUT = SMOKE ? 'out-smoke' : 'out'
const {
  sessions: SESSIONS,
  bindings: BINDINGS,
  orgId: ORG_ID,
} = JSON.parse(open('/work/sessions.json'))
const AVATAR = open('/lt/k6/avatar.png', 'b')
if (!ORG_ID || SESSIONS?.length !== VISITORS)
  throw new Error('run prepare.js first (sessions.json incomplete)')

const SLOTS = [
  ...Array(13).fill('browse'),
  'team',
  'public',
  'public',
  'public',
  'notify',
  'notify',
  'upload',
]

export const options = {
  tlsAuth,
  hosts: HOSTS,
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max', 'count'],
  // Always-true thresholds only expose per-scenario counters (setup requests carry no
  // scenario tag, so they stay out); stop rules are applied by classify.mjs afterwards,
  // so k6 never aborts a step on its own.
  thresholds: {
    'iterations{scenario:site}': ['count>=0'],
    'iterations{scenario:admin}': ['count>=0'],
    'http_reqs{scenario:site}': ['count>=0'],
    'http_reqs{scenario:admin}': ['count>=0'],
    'http_req_failed{scenario:site}': ['rate>=0'],
    'http_req_failed{scenario:admin}': ['rate>=0'],
  },
  // gracefulStop 0: iterations still running at the end are interrupted, so every counted
  // iteration and request finished inside the measured window (no drain to account for).
  scenarios: {
    site: {
      executor: 'constant-arrival-rate',
      exec: 'site',
      rate: Math.round(RATE * 10),
      timeUnit: '10s',
      duration: DURATION,
      gracefulStop: '0s',
      preAllocatedVUs: Math.max(20, Math.ceil(RATE * 2)),
      maxVUs: Math.max(60, Math.ceil(RATE * 8)),
    },
    admin: {
      executor: 'constant-arrival-rate',
      exec: 'admin',
      rate: Math.max(1, Math.round(ADMIN_RATE * 10)),
      timeUnit: '10s',
      duration: DURATION,
      gracefulStop: '0s',
      preAllocatedVUs: 2,
      maxVUs: 5,
    },
  },
}

export function setup() {
  const res = http.post(
    `${API}/auth/login`,
    JSON.stringify({ email: OWNER_EMAIL, password: PASSWORD }),
    {
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ADMIN_IP },
      responseType: 'text',
    }
  )
  if (res.status !== 200) throw new Error(`owner sign-in answered ${res.status}`)
  // The measured window starts when the scenarios start, right after setup.
  return { adminToken: res.json('accessToken'), start: Date.now() / 1000 }
}

const bff = (i, extra = {}) => ({
  headers: { origin: ORIGIN, 'x-forwarded-for': memberIp(i), ...extra },
  cookies: { amcore_session: SESSIONS[i] },
  redirects: 0,
})
// One check per action, named like the request tag, for the exact expected status.
const ok = (res, name, status = 200) => check(res, { [name]: (r) => r.status === status })
const get = (url, params, name) => ok(http.get(url, { ...params, tags: { name } }), name)

export function site() {
  const k = exec.scenario.iterationInTest
  const i = k % VISITORS
  const action = SMOKE
    ? SLOTS[k % SLOTS.length]
    : SLOTS[(k + Math.floor(k / VISITORS)) % SLOTS.length]
  const ctx = (v) => bff(v, { 'x-amcore-context-session': BINDINGS[v] })
  if (action === 'browse') {
    get(`${WEB}/api/auth/me`, bff(i), 'bff_me')
    get(`${WEB}/api/product-access/organizations`, ctx(i), 'bff_orgs')
    get(`${WEB}/api/product-access/organizations/${ORG_ID}/context`, ctx(i), 'bff_context')
    get(`${WEB}${PREFIX}/settings/sessions`, bff(i), 'ssr_sessions')
  } else if (action === 'team') {
    get(
      `${WEB}/api/product-access/organizations/${ORG_ID}/members`,
      ctx(i % ORG_ADMINS),
      'bff_members'
    )
  } else if (action === 'public') {
    get(
      `${WEB}${PREFIX}/login`,
      { headers: { 'x-forwarded-for': anonymousIp(i) }, redirects: 0 },
      'ssr_login'
    )
  } else if (action === 'notify') {
    const body = JSON.stringify({ name: `Load member ${i + 1} ${k % 7}` })
    ok(
      http.patch(`${WEB}/api/auth/me`, body, {
        ...bff(i, { 'content-type': 'application/json' }),
        tags: { name: 'bff_profile' },
      }),
      'bff_profile'
    )
    get(`${WEB}/api/notifications/unread-count`, bff(i), 'bff_unread')
  } else {
    const form = { file: http.file(AVATAR, 'avatar.png', 'image/png') }
    ok(
      http.post(`${WEB}/api/auth/me/avatar`, form, { ...bff(i), tags: { name: 'bff_avatar' } }),
      'bff_avatar',
      201
    )
  }
}

export function admin(data) {
  const params = {
    headers: { authorization: `Bearer ${data.adminToken}`, 'x-forwarded-for': ADMIN_IP },
  }
  get(`${API}/admin/users?limit=20`, params, 'admin_users')
  get(`${API}/admin/audit-logs?limit=20`, params, 'admin_audit')
}

// The admin token stays out of every file: only the window leaves setup data.
export function handleSummary(data) {
  const step = __ENV.LT_STEP ?? 'step'
  const start = data.setup_data?.start
  const { setup_data: _secret, ...summary } = data
  const window = {
    start,
    end: start + Number(DURATION.slice(0, -1)),
    rate: RATE,
    adminRate: ADMIN_RATE,
    duration: DURATION,
    smoke: SMOKE,
  }
  return {
    [`/work/${OUT}/${step}.summary.json`]: JSON.stringify(summary),
    [`/work/${OUT}/${step}.window.json`]: JSON.stringify(window),
  }
}
