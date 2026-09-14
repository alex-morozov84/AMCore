import { test } from 'node:test'
import assert from 'node:assert/strict'
import { removeTextBlock, replaceTextBlock } from './path-algebra-text-representation.mjs'

const ctx = { path: 'apps/web/eslint.config.mjs', operationKey: 'test-op' }

test('removeTextBlock removes the single occurrence', () => {
  assert.equal(removeTextBlock('a\nBLOCK\nb', 'BLOCK\n', ctx), 'a\nb')
})

test('removeTextBlock throws missing-anchor on zero occurrences', () => {
  assert.throws(() => removeTextBlock('a\nb', 'MISSING', ctx), /missing-anchor/)
})

test('removeTextBlock throws ambiguous-anchor on multiple occurrences', () => {
  assert.throws(() => removeTextBlock('X X', 'X', ctx), /ambiguous-anchor/)
})

test('replaceTextBlock replaces the single occurrence', () => {
  assert.equal(replaceTextBlock('before-text-here', 'text', 'value', ctx), 'before-value-here')
})

test('replaceTextBlock throws missing-anchor on zero occurrences', () => {
  assert.throws(() => replaceTextBlock('abc', 'zzz', 'q', ctx), /missing-anchor/)
})

test('replaceTextBlock throws ambiguous-anchor on multiple occurrences', () => {
  assert.throws(() => replaceTextBlock('aa aa', 'aa', 'b', ctx), /ambiguous-anchor/)
})
