import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  jsonDeleteTransform,
  jsonPatchTransform,
  linePatchesTransform,
  markdownFieldsTransform,
} from './content-transforms.mjs'

describe('content transforms', () => {
  test('markdown fields update and insert through explicit anchors', () => {
    const before = '- **Product:** AMCore\n- **Workflow mode:** strict\n'
    const after = markdownFieldsTransform([
      { label: 'Product', value: 'Acme' },
      { label: 'theme_persistence', value: 'cookie-ssr', insertAfterLabel: 'Workflow mode' },
    ])(before)
    assert.equal(
      after,
      '- **Product:** Acme\n- **Workflow mode:** strict\n- **theme_persistence:** cookie-ssr\n'
    )
  })

  test('line patches require a unique capture and preserve siblings', () => {
    const before = "const before = true\nname: 'AMCore',\nconst after = true\n"
    const output = linePatchesTransform([{ regex: /^name: '([^']*)',$/m, value: 'Acme' }])(before)
    assert.equal(output, "const before = true\nname: 'Acme',\nconst after = true\n")
    assert.throws(() => linePatchesTransform([{ regex: /missing (x)/, value: 'x' }])(before))
  })

  test('JSON operations preserve unrelated properties', () => {
    const before = '{"name":"old","keep":{"value":1},"remove":true}\n'
    const patched = jsonPatchTransform({ name: 'new' })(before)
    const output = jsonDeleteTransform(['remove'])(patched)
    assert.deepEqual(JSON.parse(output), { name: 'new', keep: { value: 1 } })
  })
})
