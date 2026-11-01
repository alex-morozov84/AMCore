import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assertBlockOrder, ownedBlockPrefix } from './ownership-seams.mjs'

const file = 'docs/guide.md'
const seam = {
  id: 'feature.guide-step',
  selector: {
    start: 'Add focused unit tests',
    end: '  browser coverage',
    preserveStartPrefix: true,
  },
}
const original = [
  '# Guide',
  '',
  '7. Prepare the fixture.',
  '8. Add focused unit tests and',
  '   browser coverage.',
  '9. Update the plain-language note.',
  '',
].join('\n')

function errorHasDetails(error, startCount, endCount) {
  assert.match(error.message, /feature\.guide-step/)
  assert.match(error.message, /docs\/guide\.md/)
  assert.match(error.message, /start "Add focused unit tests/)
  assert.match(error.message, /end " {2}browser coverage/)
  assert.match(error.message, new RegExp(`start .* found ${startCount}`))
  assert.match(error.message, new RegExp(`end .* found ${endCount}`))
  return true
}

test('a block with one ordered-list prefix passes and exposes that prefix', () => {
  assert.doesNotThrow(() => assertBlockOrder(original, seam, file))
  assert.equal(ownedBlockPrefix(original, seam, file), '8. ')
})

test('renumbering an earlier step carries the source ordinal into the prefix', () => {
  const renumbered = original
    .replace('7. Prepare the fixture.', '7. Prepare the fixture.\n8. Document the seam.')
    .replace('8. Add focused unit tests', '9. Add focused unit tests')
  assert.equal(ownedBlockPrefix(renumbered, seam, file), '9. ')
})

test('missing and duplicate anchors report both searched values and counts', () => {
  const missing = original.replace('Add focused unit tests', 'Write focused unit tests')
  assert.throws(
    () => assertBlockOrder(missing, seam, file),
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
