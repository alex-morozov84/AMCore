import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  EngineError,
  escapeRegExp,
  replaceCapturedField,
  setMarkdownField,
  readMarkdownField,
  setJsonPath,
  deleteJsonPath,
  readPngDimensions,
  escapeTsSingleQuoteInner,
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

  test('regression: does not corrupt the line when the captured value text also appears earlier in the match', () => {
    // Agent 2's repro: label "Product" and value "Product" collide under a
    // naive `match[0].indexOf(captured)` search, which finds "Product"
    // inside "**Product:**" instead of the actual value at the end.
    const out = replaceCapturedField('- **Product:** Product', /^- \*\*Product:\*\* (.*)$/, 'Acme')
    assert.equal(out, '- **Product:** Acme')
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

  test('fails closed on a value containing a newline', () => {
    assert.throws(() => setMarkdownField(content, { label: 'Product', value: 'a\nb' }), EngineError)
  })
})

describe('escapeTsSingleQuoteInner', () => {
  test('escapes an embedded single quote so the result is a valid string literal', () => {
    const escaped = escapeTsSingleQuoteInner("Bob's App")
    assert.equal(escaped, "Bob\\'s App")
    // Proves it round-trips as valid JS, not just visually plausible.
    assert.equal(new Function(`return '${escaped}'`)(), "Bob's App")
  })

  test('escapes a backslash', () => {
    assert.equal(escapeTsSingleQuoteInner('a\\b'), 'a\\\\b')
  })

  test('fails closed on a newline', () => {
    assert.throws(() => escapeTsSingleQuoteInner('a\nb'), EngineError)
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

describe('deleteJsonPath', () => {
  test('deletes a top-level key', () => {
    const obj = { name: 'Acme', version: '1.0.0' }
    deleteJsonPath(obj, 'version')
    assert.deepEqual(obj, { name: 'Acme' })
  })

  test('deletes a dotted-path key, preserving siblings', () => {
    const obj = { scripts: { dev: 'x', storybook: 'y' } }
    deleteJsonPath(obj, 'scripts.storybook')
    assert.deepEqual(obj, { scripts: { dev: 'x' } })
  })

  test('fails closed when the key is absent', () => {
    assert.throws(() => deleteJsonPath({ scripts: {} }, 'scripts.storybook'), EngineError)
  })

  test('fails closed when an intermediate segment is not an object', () => {
    assert.throws(
      () => deleteJsonPath({ scripts: 'not-an-object' }, 'scripts.storybook'),
      EngineError
    )
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
