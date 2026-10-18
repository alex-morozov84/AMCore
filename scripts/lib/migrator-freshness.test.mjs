import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dockerPins, migratorFreshness, renderMigrator } from './migrator-freshness.mjs'

test('Docker freshness includes a distinct migrator digest and deduplicates identical pins', () => {
  const first = '1'.repeat(64)
  const second = '2'.repeat(64)
  const rows = dockerPins(
    'fixture/Dockerfile',
    `FROM node:24-slim@sha256:${first} AS build\nFROM node:24-slim@sha256:${second} AS migrator\nFROM node:24-slim@sha256:${first} AS runner\n`
  )
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0].stages, ['build', 'runner'])
  assert.deepEqual(rows[1].stages, ['migrator'])
  assert.equal(rows[1].pinned, second)
})

test('migrator freshness queries its separate graph and installer, including prerelease signals', async () => {
  const requested = []
  const rows = await migratorFreshness(new URL('../..', import.meta.url).pathname, async (url) => {
    requested.push(url)
    return { ok: true, json: async () => ({ 'dist-tags': { latest: '8.0.0-rc.23' } }) }
  })
  assert.equal(requested.length, 3)
  assert.deepEqual(rows.map((row) => row.name).sort(), ['dotenv', 'pnpm', 'prisma'])
  assert.ok(rows.every((row) => row.latest === '8.0.0-rc.23'))
  assert.match(renderMigrator(rows).join('\n'), /review majors\/prereleases manually/)
})

for (const response of [
  { ok: false, status: 503 },
  { ok: true, json: async () => ({}) },
])
  test(`migrator freshness reports unknown for failed metadata ${response.status ?? 'shape'}`, async () => {
    const rows = await migratorFreshness(
      new URL('../..', import.meta.url).pathname,
      async () => response
    )
    assert.ok(rows.every((row) => row.error && !row.latest))
    assert.match(renderMigrator(rows).join('\n'), /unknown:/)
  })
