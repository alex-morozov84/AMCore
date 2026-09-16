import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, test } from 'node:test'

import { defineOwnershipManifest } from './ownership-manifest.mjs'
import { buildProjectStorybookFacts } from './project-storybook-facts.mjs'
import { validateOwnership } from './ownership-validate.mjs'
import { storybookOwnership } from './storybook-ownership.mjs'
import { createRealRepoCopy } from './test-fixture.mjs'

let copy
afterEach(() => copy?.cleanup())

function fixture() {
  copy = createRealRepoCopy()
  return copy.root
}

function write(root, relative, content) {
  const target = path.join(root, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function missingSeam(error) {
  return error?.code === 'missing-declared-seam'
}

describe('Storybook ownership discovery', () => {
  test('automatically owns new files below the closed root and story glob', () => {
    const root = fixture()
    write(root, 'apps/web/.storybook/nested/new-addon.ts', 'export {}\n')
    write(root, 'apps/web/src/shared/ui/new-control.stories.tsx', 'export default {}\n')
    const { inventory } = validateOwnership(root, storybookOwnership)
    assert.ok(
      inventory.rootFiles
        .get('apps/web/.storybook')
        .includes('apps/web/.storybook/nested/new-addon.ts')
    )
    const storyFact = storybookOwnership.facts.verification[0]
    assert.ok(
      inventory.matches.get(storyFact).includes('apps/web/src/shared/ui/new-control.stories.tsx')
    )
    const { facts } = buildProjectStorybookFacts(root, { selected: { storybook: true } })
    assert.ok(facts.some((fact) => fact.path === 'apps/web/.storybook'))
    assert.ok(facts.some((fact) => fact.path === 'apps/web/src/shared/ui/new-control.stories.tsx'))
  })

  test('rejects unregistered code, standalone tests, and shared config contributions', () => {
    for (const relative of [
      'apps/web/src/shared/lib/unregistered-storybook.ts',
      'apps/web/src/shared/lib/unregistered-storybook.test.ts',
      'apps/web/next.config.ts',
    ]) {
      const root = fixture()
      write(
        root,
        relative,
        "import type { Meta } from '@storybook/nextjs-vite'\nexport type X = Meta\n"
      )
      assert.throws(() => validateOwnership(root, storybookOwnership), missingSeam)
      copy.cleanup()
      copy = undefined
    }
  })

  test('rejects a declared but unresolved dynamic reference', () => {
    const root = fixture()
    const relative = 'apps/web/src/shared/lib/dynamic-storybook.ts'
    write(
      root,
      relative,
      "const packageName = '@storybook/nextjs-vite'\nexport const load = () => import(packageName)\n"
    )
    const seam = {
      id: 'storybook.dynamic-test',
      path: relative,
      kind: 'file',
      cardinality: 'one',
      seamKind: 'owned-block',
      selector: { text: '@storybook/nextjs-vite' },
      detectors: ['@storybook/nextjs-vite'],
      disposition: 'retain',
    }
    const manifest = defineOwnershipManifest({
      ...storybookOwnership,
      seams: [...storybookOwnership.seams, seam],
    })
    assert.throws(
      () => validateOwnership(root, manifest),
      (error) => error?.code === 'unresolved-dynamic-reference'
    )
  })
})
