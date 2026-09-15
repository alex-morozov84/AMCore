import assert from 'node:assert/strict'
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { createTransactionFixture, writeFixture } from './filesystem-transaction-test-helpers.mjs'
import { materializeLegacySteps } from './legacy-step-materializer.mjs'

let fixture
let external
afterEach(() => {
  fixture?.cleanup()
  if (external) rmSync(external, { recursive: true, force: true })
})

function copyStep(source, target) {
  return { kind: 'copy', source, target, changed: true, summary: 'copy asset' }
}

function prepare(mode = 0o751) {
  fixture = createTransactionFixture()
  external = mkdtempSync(path.join(tmpdir(), 'amcore-external-asset-'))
  const source = path.join(external, 'asset.png')
  writeFileSync(source, Buffer.from('original'))
  chmodSync(source, mode)
  return { root: fixture.root, source }
}

describe('external asset snapshots', () => {
  it('never rereads the source after planning and protects its internal Buffer', () => {
    const { root, source } = prepare()
    const target = path.join(root, 'asset.png')
    const plan = materializeLegacySteps(root, [copyStep(source, target)])
    writeFileSync(source, 'mutated')
    const exposed = plan.operationsForApply()
    exposed[0].bytes.fill(0)
    applyFilesystemTransaction({ root, operations: plan.operationsForApply() })
    assert.equal(readFileSync(target, 'utf8'), 'original')
  })

  it('matches copyFileSync mode for new and existing regular destinations', () => {
    const { root, source } = prepare(0o751)
    const legacyNew = path.join(root, 'legacy-new.png')
    const legacyExisting = writeFixture(root, 'legacy-existing.png', 'old', 0o640)
    copyFileSync(source, legacyNew)
    copyFileSync(source, legacyExisting)
    for (const name of ['new', 'existing']) {
      const target =
        name === 'new'
          ? path.join(root, 'new.png')
          : writeFixture(root, 'existing.png', 'old', 0o640)
      const plan = materializeLegacySteps(root, [copyStep(source, target)])
      applyFilesystemTransaction({ root, operations: plan.operationsForApply() })
      assert.equal(
        statSync(target).mode & 0o7777,
        statSync(path.join(root, `legacy-${name}.png`)).mode & 0o7777
      )
    }
  })

  it('rejects symlink and special external sources', () => {
    const { root, source } = prepare()
    const link = path.join(external, 'link.png')
    symlinkSync(source, link)
    assert.throws(
      () => materializeLegacySteps(root, [copyStep(link, path.join(root, 'asset.png'))]),
      /regular file/
    )
  })

  it('keeps an external source out of every M4 endpoint', () => {
    const { root, source } = prepare()
    const plan = materializeLegacySteps(root, [
      copyStep(source, path.join(root, 'nested/asset.png')),
    ])
    const [operation] = plan.operationsForApply()
    assert.deepEqual(Object.keys(operation).sort(), ['bytes', 'kind', 'mode', 'target'])
    assert.equal(operation.target, 'nested/asset.png')
    assert.equal(operation.target.includes(external), false)
  })
})
