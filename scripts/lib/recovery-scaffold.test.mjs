import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { prepareProjectInit } from './project-init-plan.mjs'
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'

function files(root, directory) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const name = `${directory}/${entry.name}`
    return entry.isDirectory() ? files(root, name) : [name]
  })
}

for (const [name, flags] of [
  [
    'single Russian locale without optional UI',
    {
      mode: 'single',
      locale: 'ru',
      storybook: 'disabled',
      'route-progress': 'disabled',
      'admin-console': 'disabled',
    },
  ],
  [
    'single English locale with separate Console host',
    { mode: 'single', locale: 'en', 'admin-console': 'host' },
  ],
])
  test(`generic recovery and pool shutdown survive ${name}`, () => {
    const copy = createWorkingTreeCopy()
    try {
      const retained = [
        ...files(copy.root, 'docker/postgres'),
        ...files(copy.root, 'scripts/load-test'),
        'apps/api/src/prisma/prisma.service.ts',
        'apps/api/src/prisma/pool-errors.ts',
        'apps/api/src/prisma/pool-errors.spec.ts',
        'apps/api/test/prisma-pool-shutdown.e2e-spec.ts',
        'docs/operations/backup-restore.md',
        'docs/operations/load-testing.md',
      ]
      const read = (file) => readFileSync(path.join(copy.root, file), 'utf8')
      const before = new Map(retained.map((file) => [file, read(file)]))
      const shutdown = (text) => text.split('### Graceful shutdown\n')[1].split(/\n#{1,3} /)[0]
      const originalShutdown = shutdown(read('docs/operations/deployment.md'))
      assert.ok(originalShutdown.includes('docker compose stop backup'))
      const plan = prepareProjectInit(copy.root, flags, 'admin')
      applyFilesystemTransaction({
        root: copy.root,
        operations: plan.operationPlan.operationsForApply(),
      })
      for (const [file, text] of before) assert.equal(read(file), text, file)
      assert.equal(shutdown(read('docs/operations/deployment.md')), originalShutdown)
      assert.match(read('PROJECT_CONTEXT.md'), new RegExp(`base_locale:\\*\\* ${flags.locale}`))
    } finally {
      copy.cleanup()
    }
  })
