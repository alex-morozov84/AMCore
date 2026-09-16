import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, test } from 'node:test'

import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { materializeProjectContentPath } from './project-content-materializer.mjs'
import { prepareProjectInit } from './project-init-plan.mjs'
import { STORYBOOK_PACKAGE_PATHS } from './project-shared-json-operations.mjs'
import { STORYBOOK_RESIDUAL_PATTERNS } from './project-storybook-residual.mjs'
import { createRealRepoCopy } from './test-fixture.mjs'

let copy
afterEach(() => copy?.cleanup())

function fixture() {
  copy = createRealRepoCopy()
  return copy.root
}

function fact(pathname, operationKey) {
  return { kind: 'content', dimension: 'storybook', path: pathname, operationKey, params: {} }
}

describe('Storybook structural content', () => {
  test('removes only declared package fields and preserves unrelated additions', () => {
    const root = fixture()
    const pathname = 'apps/web/package.json'
    const target = path.join(root, pathname)
    const input = JSON.parse(readFileSync(target, 'utf8'))
    input.scripts['unrelated:check'] = 'node unrelated.mjs'
    input.devDependencies['unrelated-package'] = '^1.2.3'
    writeFileSync(target, `${JSON.stringify(input, null, 2)}\n`)
    const { after } = materializeProjectContentPath(root, pathname, [
      fact(pathname, 'package-storybook'),
    ])
    const output = JSON.parse(after)
    assert.equal(output.scripts['unrelated:check'], 'node unrelated.mjs')
    assert.equal(output.devDependencies['unrelated-package'], '^1.2.3')
    for (const dotted of STORYBOOK_PACKAGE_PATHS) {
      const [group, name] = dotted.split('.')
      assert.equal(Object.hasOwn(output[group], name), false, dotted)
    }
  })

  test('Vitest AST removal preserves unrelated declarations and fails on ambiguity', () => {
    const root = fixture()
    const pathname = 'apps/web/vitest.config.ts'
    const target = path.join(root, pathname)
    const original = readFileSync(target, 'utf8')
    writeFileSync(target, `const unrelated = 42\n${original}`)
    const operation = fact(pathname, 'storybook.vitest-project')
    const { after } = materializeProjectContentPath(root, pathname, [operation])
    assert.match(after, /const unrelated = 42/)
    assert.doesNotMatch(after, /@storybook|name: 'storybook'|msw-storybook-addon/)

    writeFileSync(
      target,
      original.replace(
        '    projects: [\n',
        "    projects: [\n      { test: { name: 'storybook' } },\n"
      )
    )
    assert.throws(() => materializeProjectContentPath(root, pathname, [operation]))
    writeFileSync(target, original.replace("name: 'storybook'", "name: 'workshop'"))
    assert.throws(() => materializeProjectContentPath(root, pathname, [operation]))
  })

  test('mixed documentation operations preserve unrelated sections', () => {
    const root = fixture()
    const pathname = 'docs/frontend/testing.md'
    const target = path.join(root, pathname)
    const marker = '\n## Downstream product note\nKeep this unrelated section.\n'
    writeFileSync(target, readFileSync(target, 'utf8') + marker)
    const { after } = materializeProjectContentPath(root, pathname, [
      fact(pathname, 'storybook.docs-testing'),
    ])
    assert.ok(after.endsWith(marker))
    assert.doesNotMatch(after, /path in Storybook instead|test:storybook/)
  })

  test('documentation anchors fail closed when missing or duplicated', () => {
    const root = fixture()
    const pathname = 'docs/frontend/testing.md'
    const target = path.join(root, pathname)
    const original = readFileSync(target, 'utf8')
    const operation = fact(pathname, 'storybook.docs-testing')
    writeFileSync(target, original.replace("`apps/web`'s test surface (Track 7, **ADR-069**;", ''))
    assert.throws(
      () => materializeProjectContentPath(root, pathname, [operation]),
      /exactly one anchor/
    )
    writeFileSync(target, `${original}\n\`apps/web\`'s test surface (Track 7, **ADR-069**;\n`)
    assert.throws(
      () => materializeProjectContentPath(root, pathname, [operation]),
      /exactly one anchor/
    )
  })

  test('CI block removal and comment rewrites preserve unrelated jobs', () => {
    const root = fixture()
    const pathname = '.github/workflows/ci.yml'
    const target = path.join(root, pathname)
    const marker = '\n  downstream-check:\n    runs-on: ubuntu-latest\n    steps: []\n'
    writeFileSync(target, readFileSync(target, 'utf8') + marker)
    const { after } = materializeProjectContentPath(root, pathname, [
      fact(pathname, 'storybook.workflow-ci'),
    ])
    assert.ok(after.endsWith(marker))
    assert.doesNotMatch(after, /storybook-job|test:storybook/)
  })
})

describe('Storybook residual guard', () => {
  test('fails when each reviewed residual surface is restored independently', () => {
    const reviewed = Object.entries(STORYBOOK_RESIDUAL_PATTERNS).filter(
      ([pathname]) => pathname !== 'apps/web/vitest.config.ts'
    )
    assert.equal(reviewed.length, 6)
    for (const [pathname, [pattern]] of reviewed) {
      const current = createRealRepoCopy()
      try {
        const plan = prepareProjectInit(current.root, { storybook: 'disabled' }, 'admin')
        applyFilesystemTransaction({
          root: current.root,
          operations: plan.operationPlan.operationsForApply(),
        })
        const target = path.join(current.root, pathname)
        writeFileSync(target, `${readFileSync(target, 'utf8')}\n${pattern}\n`)
        assert.throws(plan.assertApplied, /Storybook residual references/)
      } finally {
        current.cleanup()
      }
    }
  })
})
