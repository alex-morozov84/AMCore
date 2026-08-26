import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  fileStep,
  copyFileStep,
  markdownFieldsTransform,
  linePatchesTransform,
  jsonPatchTransform,
} from './plan-steps.mjs'

let dir

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'amcore-plan-steps-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('fileStep', () => {
  test('computes the diff at build time and only writes on write()', () => {
    const file = path.join(dir, 'a.md')
    writeFileSync(file, '- **Product:** AMCore\n')

    const step = fileStep(
      file,
      markdownFieldsTransform([{ label: 'Product', value: 'Acme' }]),
      'update Product'
    )

    assert.equal(step.changed, true)
    assert.equal(
      readFileSync(file, 'utf8'),
      '- **Product:** AMCore\n',
      'no write before step.write()'
    )

    step.write()
    assert.equal(readFileSync(file, 'utf8'), '- **Product:** Acme\n')
  })

  test('reports changed=false and a distinct summary when nothing would change', () => {
    const file = path.join(dir, 'a.md')
    writeFileSync(file, '- **Product:** Acme\n')

    const step = fileStep(
      file,
      markdownFieldsTransform([{ label: 'Product', value: 'Acme' }]),
      'update Product'
    )

    assert.equal(step.changed, false)
    assert.match(step.summary, /already up to date/)
  })
})

describe('linePatchesTransform', () => {
  test('rewrites a known single-quoted field line, leaving siblings intact', () => {
    const before = "name: 'AMCore',\nshort_name: 'AMCore',\n"
    const after = linePatchesTransform([{ regex: /^name: '([^']*)',$/m, value: 'Acme' }])(before)
    assert.equal(after, "name: 'Acme',\nshort_name: 'AMCore',\n")
  })
})

describe('jsonPatchTransform', () => {
  test('sets a dotted-path key and re-serializes at 2-space indent with a trailing newline', () => {
    const after = jsonPatchTransform({ 'meta.title': 'Acme' })(
      '{\n  "meta": {\n    "title": "AMCore"\n  }\n}'
    )
    assert.equal(after, '{\n  "meta": {\n    "title": "Acme"\n  }\n}\n')
  })
})

describe('copyFileStep', () => {
  test('creates missing parent directories and copies bytes exactly', () => {
    const src = path.join(dir, 'src.png')
    writeFileSync(src, Buffer.from([1, 2, 3]))
    const dest = path.join(dir, 'nested', 'deep', 'dest.png')

    const step = copyFileStep(src, dest, 'copy')
    assert.equal(existsSync(dest), false)

    step.write()
    assert.ok(readFileSync(dest).equals(Buffer.from([1, 2, 3])))
  })
})
