import assert from 'node:assert/strict'
import test from 'node:test'
import { composeArguments } from './docker.mjs'
import { localWatchStatus } from './local-watch-status.mjs'

const stand = {
  watchExpected: true,
  snapshot: '/tmp/checkout with spaces/source',
  overlay: '/tmp/checkout with spaces/stand.yml',
  envFile: '/tmp/checkout with spaces/stand.env',
  project: 'preview-a',
}
const row = {
  uid: process.getuid(),
  command: `docker ${composeArguments(stand).join(' ')} watch --no-up web`,
}

test('reports only the expected Compose Watch for this stand', () => {
  const bare = { ...row, command: row.command.replace(' --no-up web', '') }
  const other = { ...bare, command: `${bare.command}er` }
  assert.equal(
    localWatchStatus(stand, () => [bare]),
    'running'
  )
  assert.equal(
    localWatchStatus(stand, () => [other]),
    'stopped'
  )
  assert.equal(
    localWatchStatus(stand, () => [row]),
    'running'
  )
  assert.equal(
    localWatchStatus(stand, () => [{ ...row, uid: row.uid + 1 }]),
    'stopped'
  )
  const foreign = { ...row, command: row.command.replace('preview-a', 'preview-b') }
  const diagnostic = { ...row, command: `sh -c ${row.command}` }
  assert.equal(
    localWatchStatus(stand, () => [foreign, diagnostic]),
    'stopped'
  )
  assert.equal(
    localWatchStatus({ ...stand, watchExpected: false }, () => [row]),
    undefined
  )
  assert.equal(
    localWatchStatus(stand, () => {
      throw Error('ps unavailable')
    }),
    'unknown'
  )
})
