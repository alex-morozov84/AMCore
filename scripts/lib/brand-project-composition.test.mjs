import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import { prepareBrandInit } from './brand-init-plan.mjs'
import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { prepareProjectInit } from './project-init-plan.mjs'
import { createRealRepoCopy } from './test-fixture.mjs'

let fixture
afterEach(() => fixture?.cleanup())

test('representative init:project composition remains valid after init:brand', () => {
  fixture = createRealRepoCopy()
  const brand = prepareBrandInit(fixture.root, {
    productName: 'Acme',
    productDescription: 'Downstream product',
    workflowMode: 'flexible',
  })
  applyFilesystemTransaction({
    root: fixture.root,
    operations: brand.operationPlan.operationsForApply(),
  })
  const project = prepareProjectInit(
    fixture.root,
    {
      mode: 'single',
      locale: 'en',
      storybook: 'disabled',
      'route-progress': 'disabled',
      'admin-console': 'path',
    },
    'ops'
  )
  assert.ok(project.operationPlan.operationCount > 0)
  assert.equal(project.steps.filter((step) => step.target.endsWith('PROJECT_CONTEXT.md')).length, 1)
  applyFilesystemTransaction({
    root: fixture.root,
    operations: project.operationPlan.operationsForApply(),
  })
  const context = readFileSync(path.join(fixture.root, 'PROJECT_CONTEXT.md'), 'utf8')
  assert.match(context, /- \*\*Product:\*\* Acme$/m)
  assert.match(context, /- \*\*i18n_mode:\*\* single$/m)
  assert.equal(
    readFileSync(path.join(fixture.root, 'apps/web/messages/en.json'), 'utf8').includes('Acme'),
    true
  )
})
