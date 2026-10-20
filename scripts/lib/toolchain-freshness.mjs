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

async function pnpmRow(root, request) {
  const manifest = JSON.parse(read(root, 'package.json'))
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

async function nodeSignal(request) {
  const [index, schedule] = await Promise.all([
    getJson(request, NODE_INDEX),
    getJson(request, NODE_SCHEDULE),
  ])
  const now = new Date()
  const lts = index.find((release) => release.lts)
  if (!lts) throw new Error('no LTS release in the Node index')
  const ltsLine = schedule[`v${major(lts.version)}`]
  const current = index.find(
    (r) => !r.lts && now < new Date(schedule[`v${major(r.version)}`]?.end ?? 0)
  )
  const next = Object.entries(schedule)
    .filter(([, line]) => line.lts && new Date(line.lts) > now)
    .sort((a, b) => new Date(a[1].lts) - new Date(b[1].lts))[0]
  return {
    lts: lts.version.replace(/^v/, ''),
    maintenance: ltsLine?.maintenance,
    end: ltsLine?.end,
    current: current?.version.replace(/^v/, ''),
    nextLts: next && `${next[0]} on ${next[1].lts}`,
  }
}

async function nodeRows(root, request) {
  let selectors
  try {
    selectors = localNodeSelectors(root)
  } catch (error) {
    return [{ name: 'Node.js', error: `could not read local pins: ${error.message}` }]
  }
  const engines = JSON.parse(read(root, 'package.json')).engines?.node
  const rows = selectors.map(({ selector, sources }) => ({
    name: `Node.js ${selector} (major selector)`,
    selector,
    sources,
  }))
  rows.push({ name: 'Node.js (root engines.node)', range: engines })
  try {
    const signal = await nodeSignal(request)
    for (const row of rows) Object.assign(row, { signal })
  } catch (error) {
    for (const row of rows) row.error = error.message
  }
  return rows
}

export async function toolchainFreshness(root, request = fetch) {
  return [await pnpmRow(root, request), ...(await nodeRows(root, request))]
}

function renderRow(row) {
  const { name, error, signal } = row
  if (row.range !== undefined)
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
  const behind = major(row.selector) < major(signal.lts)
  const status = behind ? '⚠️ older than the LTS line' : '✅'
  return `| ${name}${where} | ${row.selector} | LTS ${signal.lts} (maintenance ${signal.maintenance ?? '?'}, end ${signal.end ?? '?'}); current ${signal.current ?? 'none'}; next LTS ${signal.nextLts ?? 'none'} ${status} |`
}

export function renderToolchain(rows) {
  return [
    '## Toolchain: pnpm and Node.js',
    '',
    'Dependabot does not bump `packageManager` or Node selectors. Move pnpm in one PR: root pin, both `corepack prepare` lines, the stand installer and `docker/migrator` together. Node selectors are majors; digests are in the Docker section.',
    '',
    '| Item | Pinned | Latest signal |',
    '|---|---|---|',
    ...rows.map(renderRow),
    '',
  ]
}
