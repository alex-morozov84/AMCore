import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  EngineError,
  escapeRegExp,
  replaceCapturedField,
  setMarkdownField,
  readMarkdownField,
  setJsonPath,
  readPngDimensions,
} from './actions.mjs'

describe('escapeRegExp', () => {
  test('escapes regex metacharacters', () => {
    assert.equal(escapeRegExp('a.b*c'), 'a\\.b\\*c')
  })
})

describe('replaceCapturedField', () => {
  test('replaces the single captured value, keeping the rest of the line', () => {
    const out = replaceCapturedField("name: 'AMCore',", /name: '([^']*)',/, 'Acme')
    assert.equal(out, "name: 'Acme',")
  })

  test('fails closed when there is no match', () => {
    assert.throws(() => replaceCapturedField('nothing here', /name: '([^']*)',/, 'x'), EngineError)
  })

  test('fails closed on more than one match (proof-fail for ambiguous edits)', () => {
    const content = "name: 'A',\nname: 'B',"
    assert.throws(() => replaceCapturedField(content, /name: '([^']*)',/g, 'x'), EngineError)
  })
})

describe('setMarkdownField', () => {
  const content = '- **Mode:** `upstream-starter`\n- **Product:** AMCore\n'

  test('replaces an existing field', () => {
    const out = setMarkdownField(content, { label: 'Product', value: 'Acme' })
    assert.match(out, /- \*\*Product:\*\* Acme/)
  })

  test('inserts a new field after the anchor when absent', () => {
    const out = setMarkdownField(content, {
      label: 'Purpose',
      value: 'Ship things',
      insertAfterLabel: 'Product',
    })
    assert.match(out, /- \*\*Product:\*\* AMCore\n- \*\*Purpose:\*\* Ship things/)
  })

  test('fails closed when the field is absent and no insertAfterLabel is given', () => {
    assert.throws(() => setMarkdownField(content, { label: 'Purpose', value: 'x' }), EngineError)
  })

  test('fails closed when the insert anchor cannot be found', () => {
    assert.throws(
      () =>
        setMarkdownField(content, {
          label: 'Purpose',
          value: 'x',
          insertAfterLabel: 'Nonexistent',
        }),
      EngineError
    )
  })

  test('is idempotent — re-running with the same value is a no-op replace', () => {
    const once = setMarkdownField(content, { label: 'Product', value: 'Acme' })
    const twice = setMarkdownField(once, { label: 'Product', value: 'Acme' })
    assert.equal(once, twice)
  })
})

describe('readMarkdownField', () => {
  test('returns the current value, or undefined if absent', () => {
    assert.equal(readMarkdownField('- **Mode:** `x`', 'Mode'), '`x`')
    assert.equal(readMarkdownField('- **Mode:** `x`', 'Missing'), undefined)
  })
})

describe('setJsonPath', () => {
  test('sets a top-level key', () => {
    const obj = {}
    setJsonPath(obj, 'name', 'Acme')
    assert.deepEqual(obj, { name: 'Acme' })
  })

  test('creates intermediate objects for a dotted path', () => {
    const obj = {}
    setJsonPath(obj, 'meta.title', 'Acme')
    assert.deepEqual(obj, { meta: { title: 'Acme' } })
  })

  test('preserves sibling keys under an existing nested object', () => {
    const obj = { meta: { title: 'AMCore', description: 'old' } }
    setJsonPath(obj, 'meta.title', 'Acme')
    assert.deepEqual(obj, { meta: { title: 'Acme', description: 'old' } })
  })
})

describe('readPngDimensions', () => {
  function fakePng(width, height) {
    const buf = Buffer.alloc(24)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
    buf.writeUInt32BE(width, 16)
    buf.writeUInt32BE(height, 20)
    return buf
  }

  test('reads width/height from the IHDR chunk', () => {
    assert.deepEqual(readPngDimensions(fakePng(192, 192)), { width: 192, height: 192 })
  })

  test('fails closed on a bad signature', () => {
    assert.throws(() => readPngDimensions(Buffer.alloc(24)), EngineError)
  })

  test('fails closed on a too-short buffer', () => {
    assert.throws(() => readPngDimensions(Buffer.alloc(4)), EngineError)
  })
})
