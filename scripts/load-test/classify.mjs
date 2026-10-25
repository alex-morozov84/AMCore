// Classifies one load step from the facts run-step.sh collected (docs/operations/load-testing.md).
//   node classify.mjs <facts.json>   → JSON { class, reasons, figures } on stdout
// valid               no stop condition and complete data
// invalid measurement data incomplete or the generator, not the server, limited the step;
//                     never reported as capacity, and it wins over every other class
// observed overload   a server-side stop condition with a healthy generator; reported with the
//                     achieved rate, not as sustained capacity at the offered rate
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const LIMITS = { p95Ms: 1000, failedRate: 0.01, memAvailableMiB: 100, generatorIdlePct: 10 }
const metric = (summary, name) => summary?.metrics?.[name]?.values ?? summary?.metrics?.[name]

// Allowed gap between k6 and the server log: requests in flight at the window edges and
// transport failures that never reached Caddy.
export const reconcileAllowance = (k6Requests) => Math.max(5, Math.ceil(k6Requests * 0.02))

export function classify(f) {
  const invalid = []
  const overload = []
  const s = f.k6Summary
  if (f.k6Exit !== 0) invalid.push(`k6 exited with ${f.k6Exit}`)
  if (!s?.metrics) invalid.push('k6 summary missing')
  if (!(f.window?.start > 0 && f.window.end > f.window.start))
    invalid.push('measured window missing')
  if (f.statsError || !f.server) invalid.push(`server stats unusable: ${f.statsError ?? 'missing'}`)
  if (f.samplerExit !== 0 || !(f.samples?.length > 0))
    invalid.push('host sampler failed or produced no samples')
  if (f.containersMissing) invalid.push('container state before or after the step missing')
  if (f.generatorIdleMinPct === undefined) invalid.push('generator CPU was not sampled')
  else if (f.generatorIdleMinPct < LIMITS.generatorIdlePct)
    invalid.push(`generator CPU saturated (idle ${f.generatorIdleMinPct} %)`)
  const seconds = f.window ? f.window.end - f.window.start : 0
  const site = metric(s, 'iterations{scenario:site}')?.count
  const admin = metric(s, 'iterations{scenario:admin}')?.count
  const requests = metric(s, 'http_reqs')?.count
  const failed = metric(s, 'http_req_failed{scenario:site}')?.rate
  const dropped = metric(s, 'dropped_iterations')?.count ?? 0
  if (s?.metrics && [site, admin, requests, failed].some((v) => typeof v !== 'number'))
    invalid.push('k6 summary lacks a required metric')
  if (typeof requests === 'number' && f.server) {
    const gap = Math.abs(requests - f.server.requests)
    if (gap > reconcileAllowance(requests))
      invalid.push(`k6 sent ${requests} requests, the server logged ${f.server.requests}`)
  }
  if (f.server && f.server.all.p95 > LIMITS.p95Ms)
    overload.push(`server p95 ${Math.round(f.server.all.p95)} ms`)
  if (failed > LIMITS.failedRate) overload.push(`failed requests ${(failed * 100).toFixed(2)} %`)
  if (dropped > 0) overload.push(`${dropped} dropped iterations`)
  if (f.restarts > 0 || f.oomKilled) overload.push('a container restarted or was OOM-killed')
  const memMin = f.samples?.length
    ? Math.min(...f.samples.map((x) => x.memAvailableMiB))
    : undefined
  if (memMin !== undefined && memMin < LIMITS.memAvailableMiB)
    overload.push(`MemAvailable ${memMin} MiB`)
  const figures = {
    offeredRate: f.window?.rate,
    achievedRate: seconds > 0 && typeof site === 'number' ? site / seconds : undefined,
    adminAchievedRate: seconds > 0 && typeof admin === 'number' ? admin / seconds : undefined,
    requests,
    serverRequests: f.server?.requests,
    serverP95Ms: f.server?.all.p95,
    failedRate: failed,
    dropped,
    memAvailableMinMiB: memMin,
    status: f.server?.status,
  }
  if (invalid.length) return { class: 'invalid measurement', reasons: invalid, figures }
  if (overload.length) return { class: 'observed overload', reasons: overload, figures }
  return { class: 'valid', reasons: [], figures }
}

const read = (dir, name) => {
  try {
    return readFileSync(join(dir, name), 'utf8')
  } catch {
    return undefined
  }
}
const json = (text) => {
  try {
    return text === undefined ? undefined : JSON.parse(text)
  } catch {
    return undefined
  }
}

// Host sampler lines: "<epoch> host avail=<MiB>"; other line kinds are kept for the report.
export const parseSamples = (text = '') =>
  text
    .split('\n')
    .map((l) => l.match(/^(\d+) host avail=(\d+)$/))
    .filter(Boolean)
    .map((m) => ({ ts: Number(m[1]), memAvailableMiB: Number(m[2]) }))

// Lowest "id" (idle) value of `vmstat <n>` output, first report (since boot) skipped.
export function generatorIdleMin(text = '') {
  const lines = text.split('\n').map((l) => l.trim().split(/\s+/))
  const header = lines.find((cols) => cols.includes('id'))
  if (!header) return undefined
  const col = header.indexOf('id')
  const rows = lines
    .filter((cols) => cols.length === header.length && /^\d+$/.test(cols[col]))
    .slice(1)
  return rows.length ? Math.min(...rows.map((cols) => Number(cols[col]))) : undefined
}

// Containers file: "<name> <restart-count> <oom-killed>" per line, before and after the step.
export function containerChange(before = '', after = '') {
  const parse = (t) =>
    new Map(
      t
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split(' '))
        .map(([n, r, o]) => [n, { r: Number(r), o }])
    )
  const a = parse(before)
  const b = parse(after)
  if (!a.size || a.size !== b.size)
    return { restarts: 0, oomKilled: false, containersMissing: true }
  let restarts = 0
  let oomKilled = false
  for (const [name, x] of b) {
    restarts += x.r - (a.get(name)?.r ?? x.r + 1)
    oomKilled ||= x.o === 'true'
  }
  return { restarts, oomKilled }
}

export function factsFromDir(dir) {
  const exit = (name) => {
    const t = read(dir, name)?.trim()
    return t && /^\d+$/.test(t) ? Number(t) : -1
  }
  const containers = containerChange(read(dir, 'containers.before'), read(dir, 'containers.after'))
  return {
    k6Exit: exit('k6.exit'),
    k6Summary: json(read(dir, 'summary.json')),
    window: json(read(dir, 'window.json')),
    server: json(read(dir, 'server.json')),
    statsError: read(dir, 'server.err')?.trim() || undefined,
    samplerExit: exit('sampler.exit'),
    samples: parseSamples(read(dir, 'samples.txt')),
    generatorIdleMinPct: generatorIdleMin(read(dir, 'generator-vmstat.txt')),
    ...containers,
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  console.log(JSON.stringify(classify(factsFromDir(process.argv[2]))))
}
