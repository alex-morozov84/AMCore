// Classifies one load step from the facts run-step.sh collected (docs/operations/load-testing.md).
//   node classify.mjs <step-dir>   → JSON { class, reasons, figures } on stdout
// valid               no stop condition and complete data
// invalid measurement data incomplete or the generator, not the server, limited the step;
//                     never reported as capacity, and it wins over every other class
// observed overload   a server-side stop condition with a healthy generator; reported with the
//                     achieved rate, not as sustained capacity at the offered rate
// k6 runs both scenarios with gracefulStop 0: iterations still running at the end are
// interrupted, so k6's scenario counters and the server log cover the same window.
import { pathToFileURL } from 'node:url'

import { factsFromDir } from './step-facts.mjs'

export const LIMITS = {
  p95Ms: 1000,
  failedRate: 0.01,
  memAvailableMiB: 100,
  generatorIdlePct: 10,
  sampleEdgeS: 15, // first/last sample within this distance of the window edges
  sampleGapS: 30,
}
// Route classes every step must reach (locale prefix folded); a reconciliation allowance
// must never hide a whole missing action.
export const REQUIRED_ROUTES = [
  '/api/auth/me',
  '/api/product-access/organizations',
  '/api/product-access/organizations/:id/context',
  '/settings/sessions',
  '/api/product-access/organizations/:id/members',
  '/login',
  '/api/notifications/unread-count',
  '/api/auth/me/avatar',
  '/api/v1/admin/users',
  '/api/v1/admin/audit-logs',
]
export const SMOKE_CHECKS = [
  'bff_me',
  'bff_orgs',
  'bff_context',
  'ssr_sessions',
  'bff_members',
  'ssr_login',
  'bff_profile',
  'bff_unread',
  'bff_avatar',
  'admin_users',
  'admin_audit',
]

const values = (s, name) => s?.metrics?.[name]?.values
// Requests that may differ between k6 and the server log: one in flight per VU at each
// edge, plus the requests of the measured clock skew at both edges.
export const reconcileAllowance = (vusMax, requestRate, skewS) =>
  vusMax + Math.ceil(requestRate * 2 * (skewS + 0.1))

function coverage(label, times, start, end) {
  if (!times.length) return [`${label} produced no samples`]
  const problems = []
  if (times[0] > start + LIMITS.sampleEdgeS) problems.push(`${label} samples start late`)
  if (times.at(-1) < end - LIMITS.sampleEdgeS)
    problems.push(`${label} samples stop before the window ends`)
  const gap = Math.max(0, ...times.slice(1).map((t, i) => t - times[i]))
  if (gap > LIMITS.sampleGapS) problems.push(`${label} samples have a ${gap} s gap`)
  return problems
}

function workload(s) {
  const site = values(s, 'http_reqs{scenario:site}')?.count
  const admin = values(s, 'http_reqs{scenario:admin}')?.count
  const siteFailed = values(s, 'http_req_failed{scenario:site}')?.rate
  const adminFailed = values(s, 'http_req_failed{scenario:admin}')?.rate
  const siteIterations = values(s, 'iterations{scenario:site}')?.count
  const adminIterations = values(s, 'iterations{scenario:admin}')?.count
  // Every measured value the result uses must be present and finite; none defaults to 0.
  const required = [site, admin, siteFailed, adminFailed, siteIterations, adminIterations]
  if (required.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) return undefined
  const requests = site + admin
  const failedRate = requests ? (site * siteFailed + admin * adminFailed) / requests : 0
  const checks = s.root_group?.checks ?? []
  const checkFails = Object.fromEntries(checks.filter((c) => c.fails).map((c) => [c.name, c.fails]))
  return { requests, failedRate, siteFailed, adminFailed, checks, checkFails }
}

function dataProblems(f, w) {
  const invalid = []
  if (f.k6Exit !== 0) invalid.push(`k6 exited with ${f.k6Exit}`)
  if (!f.k6Summary?.metrics) invalid.push('k6 summary missing')
  else if (!w) invalid.push('k6 summary lacks a required metric')
  if (f.statsError || !f.server) invalid.push(`server stats unusable: ${f.statsError ?? 'missing'}`)
  if (f.samplerExit !== 0) invalid.push('host sampler failed')
  if (f.containersMissing)
    invalid.push('container list before and after the step differs or is missing')
  if (typeof f.skewS !== 'number') invalid.push('clock skew was not measured')
  if (!(f.window?.start > 0 && f.window.end > f.window.start)) {
    invalid.push('measured window missing')
    return invalid
  }
  const { start, end } = f.window
  invalid.push(
    ...coverage(
      'host',
      f.samples.map((x) => x.ts),
      start,
      end
    )
  )
  invalid.push(
    ...coverage(
      'generator',
      f.generator.map((x) => x.ts),
      start,
      end
    )
  )
  const idle = f.generator.length ? Math.min(...f.generator.map((x) => x.idlePct)) : undefined
  if (idle !== undefined && idle < LIMITS.generatorIdlePct)
    invalid.push(`generator CPU saturated (idle ${idle} %)`)
  if (f.server?.routes) {
    const seen = new Set(Object.keys(f.server.routes).map((r) => r.replace(/^\/:locale(?=\/)/, '')))
    const missing = REQUIRED_ROUTES.filter((r) => !seen.has(r))
    if (missing.length) invalid.push(`no server records for ${missing.join(', ')}`)
  }
  if (w && f.server && typeof f.skewS === 'number') {
    const vusMax = values(f.k6Summary, 'vus_max')?.value ?? values(f.k6Summary, 'vus_max')?.max ?? 0
    const allowed = reconcileAllowance(vusMax, w.requests / (end - start), Math.abs(f.skewS))
    if (Math.abs(w.requests - f.server.requests) > allowed)
      invalid.push(
        `k6 counted ${w.requests} requests in the window, the server ${f.server.requests} (allowed ${allowed})`
      )
  }
  if (f.window.smoke && w) {
    const names = new Set(w.checks.map((c) => c.name))
    const missing = SMOKE_CHECKS.filter((n) => !names.has(n))
    if (missing.length) invalid.push(`smoke did not run ${missing.join(', ')}`)
    if (Object.keys(w.checkFails).length)
      invalid.push(`smoke checks failed: ${Object.keys(w.checkFails).join(', ')}`)
  }
  return invalid
}

export function classify(f) {
  const s = f.k6Summary
  const windowOk = f.window?.start > 0 && f.window.end > f.window.start
  const w = s?.metrics ? workload(s) : undefined
  const invalid = dataProblems(f, w)
  const overload = []
  if (f.server?.all && f.server.all.p95 > LIMITS.p95Ms)
    overload.push(`server p95 ${Math.round(f.server.all.p95)} ms`)
  if (w && w.failedRate > LIMITS.failedRate)
    overload.push(`failed requests ${(w.failedRate * 100).toFixed(2)} %`)
  if (w && w.adminFailed > LIMITS.failedRate)
    overload.push(`failed admin requests ${(w.adminFailed * 100).toFixed(2)} %`)
  const dropped = values(s, 'dropped_iterations')?.count ?? 0
  if (dropped > 0) overload.push(`${dropped} dropped iterations`)
  if (f.restarts > 0 || f.oomKilled) overload.push('a container restarted or was OOM-killed')
  if (f.recreated?.length) overload.push(`recreated during the step: ${f.recreated.join(', ')}`)
  const memMin = f.samples?.length
    ? Math.min(...f.samples.map((x) => x.memAvailableMiB))
    : undefined
  if (memMin !== undefined && memMin < LIMITS.memAvailableMiB)
    overload.push(`MemAvailable ${memMin} MiB`)
  const seconds = windowOk ? f.window.end - f.window.start : 0
  const rate = (name) => {
    const count = values(s, name)?.count
    return seconds > 0 && typeof count === 'number' ? count / seconds : undefined
  }
  const figures = {
    offeredRate: f.window?.rate,
    achievedRate: rate('iterations{scenario:site}'),
    adminAchievedRate: rate('iterations{scenario:admin}'),
    requests: w?.requests,
    serverRequests: f.server?.requests,
    serverP95Ms: f.server?.all?.p95,
    failedRate: w?.failedRate,
    adminFailedRate: w?.adminFailed,
    checkFails: w?.checkFails,
    dropped,
    memAvailableMinMiB: memMin,
    status: f.server?.status,
  }
  if (invalid.length) return { class: 'invalid measurement', reasons: invalid, figures }
  if (overload.length) return { class: 'observed overload', reasons: overload, figures }
  return { class: 'valid', reasons: [], figures }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  console.log(JSON.stringify(classify(factsFromDir(process.argv[2]))))
}
