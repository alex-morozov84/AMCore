import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { prepareBrandInit } from './brand-init-plan.mjs'
import { commit, runInitProject } from './init-project-test-helpers.mjs'
import { verifyMigrator } from './migrator-contract.mjs'
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'

const preserved = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((file) =>
    /^(?:docker\/migrator\/|scripts\/migrator-(?:preparation|lifecycle|operations|controls|application)\/|scripts\/(?:verify|cleanup)-migrator-[^/]+\.mjs$)/.test(
      file
    )
  )
preserved.push('apps/api/Dockerfile', 'pnpm-workspace.yaml')

test('brand and combined project removal preserve generic migration tooling and shared lock', () => {
  const copy = createWorkingTreeCopy()
  try {
    const before = new Map(
      preserved.map((file) => [file, readFileSync(path.join(copy.root, file))])
    )
    const brand = prepareBrandInit(copy.root, {
      productName: 'Migration fixture',
      packageName: 'migration-fixture',
    })
    applyFilesystemTransaction({
      root: copy.root,
      operations: brand.operationPlan.operationsForApply(),
    })
    commit(copy.root)
    const result = runInitProject(copy.root, [
      '--mode=single',
      '--locale=ru',
      '--storybook=disabled',
      '--route-progress=disabled',
      '--admin-console=disabled',
      '--yes',
    ])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    for (const [file, bytes] of before)
      assert.deepEqual(readFileSync(path.join(copy.root, file)), bytes, file)
    const contract = verifyMigrator(copy.root)
    assert.equal(
      contract.prisma,
      JSON.parse(readFileSync(path.join(copy.root, 'apps/api/package.json'))).devDependencies.prisma
    )
    assert.equal(
      JSON.parse(readFileSync(path.join(copy.root, 'docker/migrator/package.json'))).name,
      '@amcore/migrator'
    )
    assert.equal(
      JSON.parse(readFileSync(path.join(copy.root, 'package.json'))).name,
      'migration-fixture'
    )
    const context = readFileSync(path.join(copy.root, 'PROJECT_CONTEXT.md'), 'utf8')
    assert.match(context, /\*\*admin_console:\*\* disabled/)
    assert.match(context, /\*\*base_locale:\*\* ru/)
  } finally {
    copy.cleanup()
  }
})
