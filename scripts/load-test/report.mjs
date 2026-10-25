// Campaign report: one table and manifest.json (docs/operations/load-testing.md).
//   node report.mjs <out-dir> campaign|smoke   → <out-dir>/report.md, <out-dir>/manifest.json
// Holds no secrets: reads only result.json and the manifest key=value files.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Upper server p95 bound per offered rate from the published reference (capacity.md).
// Lower latency is not a regression; 30 it/s and above were overloaded on that host.
export const REFERENCE_P95_MS = { 5: 32, 10: 35, 20: 900 }

export function comparison(step, result) {
  const bound = REFERENCE_P95_MS[result.figures.offeredRate]
  if (!step.startsWith('r') || result.class !== 'valid' || bound === undefined) return '—'
  const { achievedRate, offeredRate, serverP95Ms } = result.figures
  const rateOk = achievedRate >= offeredRate * 0.98
  return serverP95Ms <= bound && rateOk ? `within (≤ ${bound} ms)` : `outside (bound ${bound} ms)`
}

const keyValues = (file) =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.includes('='))
        .map((l) =>
          l.slice(0, l.indexOf('=')) === 'container'
            ? ['container', Object.fromEntries(l.split(' ').map((p) => p.split('=')))]
            : [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]
        )
    : []

export function manifest(dir, mode) {
  const host = {}
  const containers = []
  for (const [k, v] of keyValues(join(dir, 'host-manifest.txt'))) {
    if (k === 'container') containers.push(v)
    else host[k] = v
  }
  const generator = Object.fromEntries(keyValues(join(dir, 'generator-manifest.txt')))
  return {
    mode,
    // The reference protocol ran; whether the host class and data match capacity.md is a
    // comparison the reader makes from the host fields, not something the harness proves.
    referenceProtocol: mode === 'campaign',
    sameCommit: Boolean(host.commit) && host.commit === generator.commit,
    sameHarness: Boolean(host.harness_sha256) && host.harness_sha256 === generator.harness_sha256,
    host,
    generator,
    containers,
  }
}

const fmt = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : 'missing')
const pct = (v) => fmt((v ?? NaN) * 100, 2)

function row(name, r) {
  const f = r.figures
  const status = Object.entries(f.status ?? {})
    .map(([s, n]) => `${s}×${n}`)
    .join(' ')
  const checks = Object.entries(f.checkFails ?? {})
    .map(([c, n]) => `${c}×${n}`)
    .join(' ')
  const cells = [
    name,
    r.class,
    fmt(f.offeredRate, 1),
    fmt(f.achievedRate, 2),
    fmt(f.adminAchievedRate, 2),
    fmt(f.serverP95Ms, 1),
    pct(f.failedRate),
    pct(f.adminFailedRate),
    checks || 'none',
    fmt(f.dropped),
    fmt(f.memAvailableMinMiB),
    status,
    comparison(name, r),
    r.reasons.join('; '),
  ]
  return `| ${cells.join(' | ')} |`
}

function readResult(file) {
  return existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8'))
    : { class: 'invalid measurement', reasons: ['result missing'], figures: {} }
}

export function report(dir, mode) {
  const stepsDir = join(dir, 'steps')
  const names = existsSync(stepsDir)
    ? readdirSync(stepsDir).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    : []
  const rows = names.map((name) => row(name, readResult(join(stepsDir, name, 'result.json'))))
  const m = manifest(dir, mode)
  const lines = [
    `# Load test report (${mode})`,
    '',
    mode === 'smoke'
      ? '**Smoke run:** not the reference protocol; never compare it with capacity.md.'
      : 'Reference protocol campaign. Compare the host fields below with capacity.md yourself.',
    `Run \`${m.host.run_id ?? 'unknown'}\`, commit \`${m.host.commit ?? 'unknown'}\` (uncommitted changes: ${m.host.dirty ?? 'unknown'}), ${m.host.arch ?? '?'}, ${m.host.cpus ?? '?'} CPUs, ${m.host.mem_total_mib ?? '?'} MiB, swap ${m.host.swap ?? 'unknown'}.`,
    `Generator: ${m.generator.cpus ?? '?'} CPUs, ${m.generator.mem_total_mib ?? '?'} MiB; same commit as the host: ${m.sameCommit ? 'yes' : 'NO'}; same harness: ${m.sameHarness ? 'yes' : 'NO'}.`,
    '',
    'Rates in iterations/s (one visitor action, about 3 requests). Server p95 from the test-entry access log.',
    '',
    '| Step | Class | Offered | Achieved | Admin | Server p95 ms | Failed % | Admin failed % | Check failures | Dropped | Min MemAvailable MiB | Status codes | Reference | Reasons |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    'Classes: valid; invalid measurement (never capacity); observed overload (achieved rate only).',
  ]
  writeFileSync(join(dir, 'report.md'), `${lines.join('\n')}\n`)
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`)
  return lines.join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [dir, mode] = process.argv.slice(2)
  if (!['campaign', 'smoke'].includes(mode))
    throw new Error('usage: report.mjs <out-dir> campaign|smoke')
  console.log(report(dir, mode))
}
