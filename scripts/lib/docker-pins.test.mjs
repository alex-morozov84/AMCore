import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dockerPins } from './docker-pins.mjs'

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
