import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { renderToolchain, toolchainFreshness } from './toolchain-freshness.mjs'

const repoRoot = new URL('../..', import.meta.url).pathname

const versions = Object.fromEntries(
  ['11.1.2', '11.28.6', '12.14.0', '13.0.0-rc.1'].map((v) => [v, {}])
)
const schedule = {
  v22: { lts: '2024-10-29', maintenance: '2025-10-21', end: '2027-04-30' },
  v24: { lts: '2025-10-28', maintenance: '2026-10-20', end: '2028-04-30' },
  v25: { start: '2025-10-15', maintenance: '2026-04-01', end: '2026-06-01' },
  v26: { start: '2026-04-22', maintenance: '2026-10-20', end: '2027-04-01' },
  v28: { start: '2027-04-21', lts: '2027-10-26', maintenance: '2028-10-20', end: '2030-04-30' },
}
const index = [
  { version: 'v26.1.0', lts: false },
  { version: 'v25.9.0', lts: false },
  { version: 'v24.18.0', lts: 'Krypton' },
]

const answers = {
  'https://registry.npmjs.org/pnpm': { 'dist-tags': { latest: '13.0.0-rc.1' }, versions },
  'https://nodejs.org/dist/index.json': index,
  'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json': schedule,
}
const respond =
  (overrides = {}) =>
  async (url) => {
    const body = { ...answers, ...overrides }[url]
    if (body instanceof Error) throw body
    if (typeof body === 'number') return { ok: false, status: body }
    return { ok: true, json: async () => body }
  }

test('pnpm row keeps the raw registry latest next to the stable and same-major signals', async () => {
  const [pnpm] = await toolchainFreshness(repoRoot, respond())
  assert.equal(pnpm.stable, '12.14.0')
  assert.equal(pnpm.registryLatest, '13.0.0-rc.1')
  assert.equal(pnpm.sameMajor, pnpm.current.startsWith('12.') ? '12.14.0' : '11.28.6')
  assert.match(renderToolchain([pnpm]).join('\n'), /registry latest 13\.0\.0-rc\.1/)
})

test('node rows list every selector with its sources and the LTS, Current and next-LTS signals', async () => {
  const rows = await toolchainFreshness(repoRoot, respond())
  const node = rows.filter((row) => row.selector)
  assert.ok(node.length >= 1)
  assert.ok(node.every((row) => row.sources.length > 0))
  assert.equal(node[0].signal.lts, '24.18.0')
  assert.equal(node[0].signal.current, '26.1.0')
  assert.match(node[0].signal.nextLts, /v28 on 2027-10-26/)
  assert.match(renderToolchain(rows).join('\n'), /engines\.node\) \| >=24/)
})

test('an EOL non-LTS line is never reported as Current', async () => {
  const rows = await toolchainFreshness(
    repoRoot,
    respond({
      'https://nodejs.org/dist/index.json': [{ version: 'v25.9.0', lts: false }, index[2]],
    })
  )
  assert.equal(rows.find((row) => row.selector).signal.current, undefined)
})

for (const [label, overrides] of [
  ['an HTTP error', { 'https://registry.npmjs.org/pnpm': 503 }],
  ['a thrown timeout', { 'https://registry.npmjs.org/pnpm': new Error('timed out') }],
  ['missing metadata', { 'https://registry.npmjs.org/pnpm': {} }],
])
  test(`a failed pnpm probe (${label}) keeps the local pin and reports unknown`, async () => {
    const [pnpm, ...rest] = await toolchainFreshness(repoRoot, respond(overrides))
    assert.ok(pnpm.current && pnpm.error)
    assert.match(renderToolchain([pnpm]).join('\n'), /unknown:/)
    assert.ok(
      rest.some((row) => row.signal),
      'node rows survive a pnpm probe failure'
    )
  })

test('a failed node probe keeps the local selectors and reports unknown', async () => {
  const rows = await toolchainFreshness(
    repoRoot,
    respond({ 'https://nodejs.org/dist/index.json': 'not-an-array' })
  )
  const node = rows.filter((row) => row.selector)
  assert.ok(node.every((row) => row.error && row.sources))
  assert.match(renderToolchain(rows).join('\n'), /unknown:/)
})

test('a missing or invalid local pin degrades to a row, not an exception', async () => {
  const root = mkdtempSync(join(tmpdir(), 'toolchain-freshness-'))
  try {
    writeFileSync(join(root, 'package.json'), '{"packageManager":"yarn@4.0.0"}')
    const [pnpm] = await toolchainFreshness(root, respond())
    assert.match(pnpm.error, /no pnpm pin/)
    mkdirSync(join(root, '.github/workflows'), { recursive: true })
    const rows = await toolchainFreshness(root, respond())
    assert.match(rows[1].error, /could not read local pins/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
