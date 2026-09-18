import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import { prepareBrandInit } from './brand-init-plan.mjs'
import { createFixtureRepo } from './test-fixture.mjs'

let fixture
afterEach(() => fixture?.cleanup())

function rewrite(relative, transform) {
  const file = path.join(fixture.root, relative)
  writeFileSync(file, transform(readFileSync(file, 'utf8')))
}

function afterFor(plan, suffix) {
  return plan.materializedSteps.find((step) => step.target.endsWith(suffix)).after
}

test('brand structural operations preserve unrelated TS and JSON siblings', () => {
  fixture = createFixtureRepo()
  rewrite('apps/web/src/app/manifest.ts', (text) =>
    text.replace('    description:', "    unrelated: 'keep',\n    description:")
  )
  rewrite(
    'apps/web/src/shared/lib/theme.ts',
    (text) => `// keep-comment\n${text}export const KEEP = 1\n`
  )
  rewrite('package.json', (text) => {
    const value = JSON.parse(text)
    value.keep = { nested: true }
    return `${JSON.stringify(value, null, 2)}\n`
  })
  const plan = prepareBrandInit(fixture.root, {
    productName: 'Acme',
    productDescription: 'Tagline',
    packageName: 'acme',
    themeMode: 'dark',
  })
  assert.match(afterFor(plan, 'manifest.ts'), /unrelated: 'keep'/)
  assert.match(afterFor(plan, 'theme.ts'), /keep-comment/)
  assert.match(afterFor(plan, 'theme.ts'), /export const KEEP = 1/)
  assert.deepEqual(JSON.parse(afterFor(plan, 'package.json')).keep, { nested: true })
})

test('missing or ambiguous semantic anchors fail before an operation plan exists', () => {
  fixture = createFixtureRepo()
  rewrite('apps/web/src/app/manifest.ts', (text) =>
    text.replace('    short_name:', "    name: 'duplicate',\n    short_name:")
  )
  assert.throws(
    () => prepareBrandInit(fixture.root, { productName: 'Acme' }),
    /brand\.manifest\.fields.*expected 3 semantic matches, found 4/
  )
  fixture.cleanup()
  fixture = createFixtureRepo()
  rewrite('apps/web/src/shared/lib/theme.ts', () => 'export const OTHER = true\n')
  assert.throws(
    () => prepareBrandInit(fixture.root, { themeMode: 'dark' }),
    /brand\.theme\.default.*expected 1 semantic matches, found 0/
  )
})
