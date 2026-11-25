import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import { prepareBrandInit } from './brand-init-plan.mjs'
import {
  applyFilesystemTransaction,
  filesystemTransactionJournalPath,
} from './filesystem-transaction.mjs'
import { filesystemSnapshot } from './filesystem-transaction-test-helpers.mjs'
import { runInitCommand } from './init-engine.mjs'
import { createFixtureRepo, fakePng, git } from './test-fixture.mjs'
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'

let fixture
afterEach(() => fixture?.cleanup())

test('brand change applies to a copy of the real working tree', () => {
  fixture = createWorkingTreeCopy()
  const { operationPlan } = prepareBrandInit(fixture.root, {
    productName: 'Acme',
    productDescription: 'Downstream product',
    workflowMode: 'flexible',
  })
  applyFilesystemTransaction({
    root: fixture.root,
    operations: operationPlan.operationsForApply(),
  })
  const context = readFileSync(path.join(fixture.root, 'PROJECT_CONTEXT.md'), 'utf8')
  assert.match(context, /- \*\*Product:\*\* Acme$/m)
  assert.equal(
    readFileSync(path.join(fixture.root, 'apps/web/messages/en.json'), 'utf8').includes('Acme'),
    true
  )
})

test('fixture disables automatic Git maintenance locally', () => {
  fixture = createFixtureRepo()
  assert.equal(
    git(fixture.root, ['config', '--local', '--bool', 'maintenance.auto']).trim(),
    'false'
  )
  assert.equal(git(fixture.root, ['config', '--local', '--int', 'gc.auto']).trim(), '0')
})

test('confirmed brand change calls M4 once with the complete plan', async () => {
  fixture = createFixtureRepo()
  const { operationPlan } = prepareBrandInit(fixture.root, {
    productName: 'Acme',
    productDescription: 'Tagline',
    themeMode: 'dark',
  })
  const calls = []
  await runInitCommand({
    cwd: fixture.root,
    flags: { yes: true },
    operationPlan,
    applyFilesystem: (input) => calls.push(input.operations),
    verify: () => [],
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].length, operationPlan.operationCount)
})

test('injected brand apply failure restores the complete filesystem snapshot', () => {
  fixture = createFixtureRepo()
  const before = filesystemSnapshot(fixture.root)
  const { operationPlan } = prepareBrandInit(fixture.root, {
    productName: 'Acme',
    productDescription: 'Tagline',
    themeMode: 'dark',
  })
  assert.throws(
    () =>
      applyFilesystemTransaction({
        root: fixture.root,
        operations: operationPlan.operationsForApply(),
        hooks: {
          afterMutation: ({ index }) => {
            if (index === 2) throw new Error('injected brand failure')
          },
        },
      }),
    /filesystem-apply-failed/
  )
  assert.deepEqual(filesystemSnapshot(fixture.root), before)
})

for (const commit of [false, true]) {
  test(`confirmation refuses a ${commit ? 'committed' : 'uncommitted'} change to the reviewed file`, async () => {
    fixture = createFixtureRepo()
    const target = path.join(fixture.root, 'PROJECT_CONTEXT.md')
    const { operationPlan } = prepareBrandInit(fixture.root, { productName: 'Acme' })
    const updated = readFileSync(target, 'utf8').replace('Product:** AMCore', 'Product:** Other')

    await assert.rejects(
      runInitCommand({
        cwd: fixture.root,
        flags: {},
        operationPlan,
        requestConfirmation: () => {
          writeFileSync(target, updated)
          if (commit) {
            git(fixture.root, ['add', 'PROJECT_CONTEXT.md'])
            git(fixture.root, [
              '-c',
              'user.name=test',
              '-c',
              'user.email=test@example.com',
              'commit',
              '-m',
              'edit identity',
            ])
          }
          return true
        },
        verify: () => assert.fail('verification must not run'),
      }),
      /Brand destination changed.*fresh plan/
    )

    assert.equal(readFileSync(target, 'utf8'), updated)
    assert.equal(existsSync(filesystemTransactionJournalPath(fixture.root)), false)
  })
}

test('confirmation rechecks a requested logo omitted from the write plan', async () => {
  fixture = createFixtureRepo()
  const logo = 'apps/web/public/logo-dark.png'
  const theme = 'apps/web/src/shared/lib/theme.ts'
  const target = path.join(fixture.root, logo)
  const beforeTheme = readFileSync(path.join(fixture.root, theme), 'utf8')
  const { operationPlan } = prepareBrandInit(fixture.root, {
    logoDarkSrc: target,
    themeMode: 'dark',
  })
  assert.deepEqual(
    operationPlan.displaySteps.map(({ target }) => target),
    [path.join(fixture.root, theme)]
  )
  assert.deepEqual(
    operationPlan.operationsForApply().map(({ target }) => target),
    [theme]
  )

  const changedLogo = fakePng(64, 64)
  await assert.rejects(
    runInitCommand({
      cwd: fixture.root,
      flags: {},
      operationPlan,
      requestConfirmation: () => {
        writeFileSync(target, changedLogo)
        git(fixture.root, [
          '-c',
          'user.name=test',
          '-c',
          'user.email=test@example.com',
          'commit',
          '-m',
          'replace logo',
          '--',
          logo,
        ])
        return true
      },
      verify: () => assert.fail('verification must not run'),
    }),
    /Brand destination changed: apps\/web\/public\/logo-dark\.png/
  )
  assert.equal(readFileSync(path.join(fixture.root, theme), 'utf8'), beforeTheme)
  assert.deepEqual(readFileSync(target), changedLogo)
  assert.equal(git(fixture.root, ['status', '--porcelain']), '')
  assert.equal(existsSync(filesystemTransactionJournalPath(fixture.root)), false)
})
