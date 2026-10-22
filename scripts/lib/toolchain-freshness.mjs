import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const STABLE = /^\d+\.\d+\.\d+$/
const NODE_INDEX = 'https://nodejs.org/dist/index.json'
const NODE_SCHEDULE = 'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json'

const numeric = (v) => String(v).replace(/^v/, '').split('.').map(Number)
const compare = (a, b) => {
  const [x, y] = [numeric(a), numeric(b)]
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}
const newest = (versions) =>
  versions
    .filter((v) => STABLE.test(v))
    .sort(compare)
    .at(-1)
const major = (v) => numeric(v)[0]

async function getJson(request, url) {
  const response = await request(url, { signal: globalThis.AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() // inside the timeout-bound call chain: a stalled body aborts too
}

const read = (root, path) => readFileSync(join(root, path), 'utf8')

function localNodeSelectors(root) {
  const found = new Map()
  const add = (major, source) => found.set(major, [...(found.get(major) ?? []), source])
  add(read(root, '.nvmrc').trim().replace(/^v/, '').split('.')[0], '.nvmrc')
  const workflows = '.github/workflows'
  for (const file of readdirSync(join(root, workflows)).filter((f) => /\.ya?ml$/.test(f)))
    for (const [, v] of read(root, `${workflows}/${file}`).matchAll(/node-version:\s*['"]?(\d+)/g))
      add(v, file)
  for (const file of ['apps/api/Dockerfile', 'apps/web/Dockerfile'])
    for (const [, v] of read(root, file).matchAll(/^FROM\s+node:(\d+)/gim)) add(v, file)
  return [...found].map(([selector, sources]) => ({ selector, sources: [...new Set(sources)] }))
}

function readManifest(root) {
  try {
    return { manifest: JSON.parse(read(root, 'package.json')) }
  } catch (error) {
    return { error: `could not read package.json: ${error.message}` }
  }
}

async function pnpmRow(root, request) {
  const { manifest, error: manifestError } = readManifest(root)
  if (manifestError) return { name: 'pnpm (root packageManager)', error: manifestError }
  const pin = /^pnpm@(\d+\.\d+\.\d+)/.exec(manifest.packageManager ?? '')?.[1]
  if (!pin) return { name: 'pnpm (root packageManager)', error: 'no pnpm pin in package.json' }
  const row = { name: 'pnpm (root packageManager)', current: pin, floor: manifest.engines?.pnpm }
  try {
    const doc = await getJson(request, 'https://registry.npmjs.org/pnpm')
    const versions = Object.keys(doc.versions ?? {})
    row.registryLatest = doc['dist-tags']?.latest
    row.stable = newest(versions)
    row.sameMajor = newest(versions.filter((v) => major(v) === major(pin)))
    if (!row.registryLatest || !row.stable) throw new Error('registry metadata missing')
  } catch (error) {
    row.error = error.message
  }
  return row
}

// Phase of a release line today, from the official schedule: 'current' (before LTS, or
// before end for lines that never get LTS), 'lts', 'maintenance', 'ended', or 'unknown'.
function linePhase(line, now) {
  if (!line?.start || !line.end) return 'unknown'
  const at = (date) => date && now >= new Date(date)
  if (!at(line.start)) return 'unknown'
  if (at(line.end)) return 'ended'
  if (at(line.maintenance)) return 'maintenance'
  return at(line.lts) ? 'lts' : 'current'
}

async function nodeSignal(request, now) {
  const [index, schedule] = await Promise.all([
    getJson(request, NODE_INDEX),
    getJson(request, NODE_SCHEDULE),
  ])
  const lts = index.find((release) => release.lts)
  if (!lts) throw new Error('no LTS release in the Node index')
  const ltsLine = schedule[`v${major(lts.version)}`]
  // The index keeps every historical release: judge the line's phase today, not the release flag.
  const current = index.find((r) => linePhase(schedule[`v${major(r.version)}`], now) === 'current')
  const next = Object.entries(schedule)
    .filter(([, line]) => line.lts && new Date(line.lts) > now)
    .sort((a, b) => new Date(a[1].lts) - new Date(b[1].lts))[0]
  return {
    lts: lts.version.replace(/^v/, ''),
    maintenance: ltsLine?.maintenance,
    end: ltsLine?.end,
    current: current?.version.replace(/^v/, ''),
    nextLts: next && `${next[0]} on ${next[1].lts}`,
    phases: (selector) => linePhase(schedule[`v${selector}`], now),
  }
}

async function nodeRows(root, request, now) {
  const { manifest, error: manifestError } = readManifest(root)
  const enginesRow = {
    name: 'Node.js (root engines.node)',
    range: manifest?.engines?.node,
    error: manifestError,
  }
  let selectors = []
  try {
    selectors = localNodeSelectors(root)
  } catch (error) {
    return [{ name: 'Node.js', error: `could not read local pins: ${error.message}` }, enginesRow]
  }
  const rows = selectors.map(({ selector, sources }) => ({
    name: `Node.js ${selector} (major selector)`,
    selector,
    sources,
  }))
  try {
    const signal = await nodeSignal(request, now)
    for (const row of rows) Object.assign(row, { signal, phase: signal.phases(row.selector) })
  } catch (error) {
    for (const row of rows) row.error = error.message
  }
  return [...rows, enginesRow]
}

export async function toolchainFreshness(root, request = fetch, now = new Date()) {
  return [await pnpmRow(root, request), ...(await nodeRows(root, request, now))]
}

// Support comes from the line's schedule phase; only the latest LTS line gets a plain green mark.
function selectorStatus({ selector, phase }, signal) {
  if (phase === 'ended') return '⚠️ end of life'
  if (phase === 'unknown') return '⚠️ no schedule data'
  if (major(selector) === major(signal.lts)) return '✅ latest LTS'
  if (phase === 'current') return 'ℹ️ Current line (not LTS)'
  return '⚠️ older supported line'
}

function renderRow(row) {
  const { name, error, signal } = row
  if ('range' in row)
    return `| ${name} | ${row.range ?? '?'} (minimum) | ${error ? `unknown: ${error}` : 'floor only; not compared'} |`
  if (name.startsWith('pnpm')) {
    if (row.current === undefined) return `| ${name} | ? | unknown: ${error} |`
    if (error) return `| ${name} | ${row.current} | unknown: ${error} |`
    const parts = [`stable ${row.stable}`, `same major ${row.sameMajor ?? 'none'}`]
    if (row.registryLatest !== row.stable) parts.push(`registry latest ${row.registryLatest}`)
    const lag =
      row.current === row.stable
        ? '✅'
        : major(row.stable) > major(row.current)
          ? '⚠️ major behind'
          : '⚠️ behind'
    return `| ${name} | ${row.current} (engines ${row.floor ?? '?'}) | ${parts.join('; ')} ${lag} |`
  }
  const where = row.sources ? ` (${row.sources.join(', ')})` : ''
  if (error) return `| ${name}${where} | ${row.selector ?? '?'} | unknown: ${error} |`
  const status = selectorStatus(row, signal)
  return `| ${name}${where} | ${row.selector} | LTS ${signal.lts} (maintenance ${signal.maintenance ?? '?'}, end ${signal.end ?? '?'}); current ${signal.current ?? 'none'}; next LTS ${signal.nextLts ?? 'none'} ${status} |`
}

export function renderToolchain(rows) {
  return [
    '## Toolchain: pnpm and Node.js',
    '',
    'Dependabot does not bump `packageManager` or Node selectors. Move pnpm in one PR: root pin, both `corepack prepare` lines, the stand installer and the official pnpm bootstrap image in the API Dockerfile together. Node selectors are majors; digests are in the Docker section.',
    '',
    '| Item | Pinned | Latest signal |',
    '|---|---|---|',
    ...rows.map(renderRow),
    '',
  ]
}
