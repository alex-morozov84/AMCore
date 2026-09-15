import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { assertNoTransactionArtifacts } from './filesystem-transaction-test-helpers.mjs'
import { JOURNAL_NAME } from './filesystem-transaction-journal.mjs'
import { runInitCommand } from './init-engine.mjs'
import {
  transactionPlan as plan,
  withTransactionRepo as withRepo,
} from './init-engine-transaction-test-helpers.mjs'
import { git } from './test-fixture.mjs'

function failAfterSecondMutation(input) {
  return applyFilesystemTransaction({
    ...input,
    hooks: {
      afterMutation: ({ index }) => {
        if (index === 1) throw new Error('injected')
      },
    },
  })
}

test('handled M4 failure restores the pre-apply tree and skips verification', async () => {
  await withRepo(async (root) => {
    let verified = false
    const operations = [
      { kind: 'write', target: 'first.txt', bytes: Buffer.from('changed-one') },
      { kind: 'write', target: 'second.txt', bytes: Buffer.from('changed-two') },
    ]
    await assert.rejects(
      () =>
        runInitCommand({
          cwd: root,
          flags: { yes: true },
          operationPlan: plan(operations),
          applyFilesystem: failAfterSecondMutation,
          verify: () => {
            verified = true
            return []
          },
        }),
      /filesystem-apply-failed/
    )
    assert.equal(readFileSync(path.join(root, 'first.txt'), 'utf8'), 'before-one\n')
    assert.equal(readFileSync(path.join(root, 'second.txt'), 'utf8'), 'before-two\n')
    assert.equal(verified, false)
    assertNoTransactionArtifacts(root)
  })
})

test('a pending journal blocks the CLI before verification', async () => {
  await withRepo(async (root) => {
    writeFileSync(path.join(root, JOURNAL_NAME), '{"version":1,"state":"prepared"}\n')
    git(root, ['add', JOURNAL_NAME])
    git(root, [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--quiet',
      '-m',
      'journal',
    ])
    let verified = false
    await assert.rejects(
      () =>
        runInitCommand({
          cwd: root,
          flags: { yes: true },
          operationPlan: plan([
            { kind: 'write', target: 'first.txt', bytes: Buffer.from('after') },
          ]),
          verify: () => {
            verified = true
            return []
          },
        }),
      /new apply is blocked/
    )
    assert.equal(verified, false)
  })
})

test('verification failure happens after commit and keeps the applied tree', async () => {
  await withRepo(async (root) => {
    const priorExitCode = process.exitCode
    process.exitCode = undefined
    await runInitCommand({
      cwd: root,
      flags: { yes: true },
      operationPlan: plan([
        { kind: 'write', target: 'first.txt', bytes: Buffer.from('committed\n') },
      ]),
      verify: () => [{ label: 'failure', ok: false, output: 'expected failure' }],
    })
    assert.equal(readFileSync(path.join(root, 'first.txt'), 'utf8'), 'committed\n')
    assert.equal(process.exitCode, 1)
    process.exitCode = priorExitCode
    assertNoTransactionArtifacts(root)
  })
})
