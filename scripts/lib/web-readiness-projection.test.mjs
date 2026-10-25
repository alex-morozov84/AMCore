import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'

import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { prepareProjectInit } from './project-init-plan.mjs'
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'

for (const [name, flags] of [
  [
    'single Russian locale without Console',
    { mode: 'single', locale: 'ru', 'admin-console': 'disabled' },
  ],
  ['separate Console host', { 'admin-console': 'host' }],
])
  test(`web readiness survives ${name}`, () => {
    const copy = createWorkingTreeCopy()
    try {
      symlinkSync(
        path.join(process.cwd(), 'node_modules'),
        path.join(copy.root, 'node_modules'),
        'dir'
      )
      const plan = prepareProjectInit(copy.root, flags, 'admin')
      applyFilesystemTransaction({
        root: copy.root,
        operations: plan.operationPlan.operationsForApply(),
      })
      plan.assertApplied()
      const read = (file) => readFileSync(path.join(copy.root, file), 'utf8')
      const base = parse(read('docker-compose.yml'))
      assert.equal(base.services.web.healthcheck.test[0], 'CMD')
      assert.match(base.services.web.healthcheck.test[3], /\/api\/deployment-version/)
      assert.equal(base.services.caddy.depends_on.web, undefined)
      assert.ok(
        existsSync(path.join(copy.root, 'apps/web/src/app/api/deployment-version/route.ts'))
      )
      const output = execFileSync(
        process.execPath,
        [
          '--test',
          'scripts/lib/web-readiness-contract.test.mjs',
          'scripts/lib/deployment-rollout-contract.test.mjs',
          'scripts/stand/compose-env-coverage.test.mjs',
        ],
        {
          cwd: copy.root,
          encoding: 'utf8',
          timeout: 60000,
          env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
        }
      )
      assert.match(output, /tests [1-9]\d*/)
      assert.doesNotMatch(output, /called recursively|skipping running files/)
    } finally {
      copy.cleanup()
    }
  })
