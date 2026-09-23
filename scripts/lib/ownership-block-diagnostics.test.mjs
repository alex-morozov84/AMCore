import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { assertBlockOrder, ownedBlockPrefix } from './ownership-seams.mjs'
import { storybookOwnedBlockDefinition } from './project-storybook-doc-content.mjs'
import { storybookOwnership } from './storybook-ownership.mjs'
import { resolvePublicRepoRoot } from './working-tree-fixture.mjs'

const file = 'docs/operations-console/development.md'
const seam = storybookOwnership.seams.find(
  (item) => item.id === 'storybook.console-development-step'
)
const original = readFileSync(path.join(resolvePublicRepoRoot(), file), 'utf8')

function errorHasDetails(error, startCount, endCount) {
  assert.match(error.message, /storybook\.console-development-step/)
  assert.match(error.message, /docs\/operations-console\/development\.md/)
  assert.match(error.message, /start "Add focused unit tests/)
  assert.match(error.message, /end "   browser\/real-stack coverage/)
  assert.match(error.message, new RegExp(`start .* found ${startCount}`))
  assert.match(error.message, new RegExp(`end .* found ${endCount}`))
  return true
}

test('current block has one ordered-list prefix and retains the current projection', () => {
  assert.doesNotThrow(() => assertBlockOrder(original, seam, file))
  assert.equal(ownedBlockPrefix(original, seam, file), '8. ')
})

test('renumbering an earlier step carries the source ordinal into the projection', () => {
  const renumbered = original.replace('8. Add focused unit tests', '10. Add focused unit tests')
  assert.equal(ownedBlockPrefix(renumbered, seam, file), '10. ')
  const projected = storybookOwnedBlockDefinition('storybook.docs-console-development').apply(
    renumbered
  )
  assert.match(projected, /10\. Add focused unit tests and browser\/real-stack coverage/)
  assert.match(projected, /\n    accessibility, auth, cookies, Redis/)
})

test('missing and duplicate anchors report both searched values and counts', () => {
  const missing = original.replace('Add focused unit tests', 'Write focused unit tests')
  assert.throws(
    () => assertBlockOrder(missing, seam, file),
    (error) => errorHasDetails(error, 0, 1)
  )
  assert.throws(
    () => storybookOwnedBlockDefinition('storybook.docs-console-development').apply(missing),
    (error) => errorHasDetails(error, 0, 1)
  )
  const duplicated = `${original}\n${seam.selector.start}\n${seam.selector.end}\n`
  assert.throws(
    () => assertBlockOrder(duplicated, seam, file),
    (error) => errorHasDetails(error, 2, 2)
  )
})

test('reversed anchors and an invalid list prefix fail with source context', () => {
  const reversed = `${seam.selector.end}\n${seam.selector.start}`
  assert.throws(() => assertBlockOrder(reversed, seam, file), /invalid anchor order/)
  const bullet = original.replace('8. Add focused unit tests', '- Add focused unit tests')
  assert.throws(() => ownedBlockPrefix(bullet, seam, file), /Markdown ordered-list prefix/)
})
