// Campaign report: one table and manifest.json from $LT_WORK/out (docs/operations/load-testing.md).
//   node report.mjs <out-dir> campaign|smoke   → <out-dir>/report.md, <out-dir>/manifest.json
// Holds no secrets: reads only result.json, window.json and the manifest key=value files.
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
  return {
    mode,
    comparable: mode === 'campaign',
    host,
    containers,
    generator: Object.fromEntries(keyValues(join(dir, 'generator-manifest.txt'))),
  }
}

const fmt = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : 'missing')

export function report(dir, mode) {
  const stepsDir = join(dir, 'steps')
  const names = existsSync(stepsDir)
    ? readdirSync(stepsDir).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    : []
  const rows = names.map((name) => {
    const file = join(stepsDir, name, 'result.json')
    const r = existsSync(file)
      ? JSON.parse(readFileSync(file, 'utf8'))
      : { class: 'invalid measurement', reasons: ['result missing'], figures: {} }
    const f = r.figures
    const status = Object.entries(f.status ?? {})
      .map(([s, n]) => `${s}×${n}`)
      .join(' ')
    return `| ${name} | ${r.class} | ${fmt(f.offeredRate, 1)} | ${fmt(f.achievedRate, 2)} | ${fmt(f.adminAchievedRate, 2)} | ${fmt(f.serverP95Ms)} | ${fmt((f.failedRate ?? NaN) * 100, 2)} | ${fmt(f.dropped)} | ${fmt(f.memAvailableMinMiB)} | ${status} | ${comparison(name, r)} | ${r.reasons.join('; ')} |`
  })
  const m = manifest(dir, mode)
  const lines = [
    `# Load test report (${mode})`,
    '',
    mode === 'smoke'
      ? '**Not comparable:** smoke run, not the reference protocol.'
      : 'Reference protocol campaign.',
    `Commit \`${m.host.commit ?? 'unknown'}\` (uncommitted changes: ${m.host.dirty ?? 'unknown'}), ${m.host.arch ?? '?'}, ${m.host.cpus ?? '?'} CPUs, ${m.host.mem_total_mib ?? '?'} MiB, swap ${m.host.swap ?? 'unknown'}.`,
    '',
    'Rates in iterations/s (one visitor action, about 3 requests). Server p95 from the test-entry access log.',
    '',
    '| Step | Class | Offered | Achieved | Admin | Server p95 ms | Failed % | Dropped | Min MemAvailable MiB | Status codes | Reference | Reasons |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
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
