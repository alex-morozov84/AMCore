import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EngineError } from './actions.mjs'
import {
  removeExactBlock,
  replaceAllExactText,
  replaceExactBlock,
  trimLocaleRecordLiteral,
} from './content-blocks.mjs'

describe('removeExactBlock', () => {
  test('removes the one occurrence of the block', () => {
    assert.equal(removeExactBlock('a\nBLOCK\nb\n', 'BLOCK\n'), 'a\nb\n')
  })

  test('fails closed when the block is absent', () => {
    assert.throws(() => removeExactBlock('a\nb\n', 'BLOCK\n'), EngineError)
  })

  test('fails closed when the block appears more than once', () => {
    assert.throws(() => removeExactBlock('BLOCK\nBLOCK\n', 'BLOCK\n'), EngineError)
  })
})

describe('replaceExactBlock', () => {
  test('replaces the one occurrence', () => {
    assert.equal(replaceExactBlock('a\nold\nb\n', 'old\n', 'new\n'), 'a\nnew\nb\n')
  })

  test('fails closed when the target text is absent', () => {
    assert.throws(() => replaceExactBlock('a\nb\n', 'old\n', 'new\n'), EngineError)
  })
})

describe('replaceAllExactText', () => {
  test('replaces every occurrence, not just one', () => {
    assert.equal(replaceAllExactText('ru, ru, ru', 'ru', 'en'), 'en, en, en')
  })

  test('fails closed when the target text is absent', () => {
    assert.throws(() => replaceAllExactText('a\nb\n', 'old', 'new'), EngineError)
  })
})

describe('trimLocaleRecordLiteral', () => {
  const content = [
    'export const x = {',
    '  en: {',
    "    title: 'Hi',",
    '  },',
    '  ru: {',
    "    title: 'Привет',",
    '  },',
    '}',
    '',
  ].join('\n')

  test('keeps only the requested locale block', () => {
    const after = trimLocaleRecordLiteral(content, 'ru')
    assert.doesNotMatch(after, /en: \{/)
    assert.match(after, /ru: \{\n {4}title: 'Привет',\n {2}\},\n/)
  })

  test('fails closed when the requested locale has no block', () => {
    assert.throws(() => trimLocaleRecordLiteral(content, 'fr'), EngineError)
  })
})
