import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  runAgainstRealRepo,
  validateRelativeLinks,
  validateRunbookPaths,
} from './validate-links-and-anchors.mjs'

test('runbook_path with a nonexistent file is rejected', () => {
  const rules = [{ alertName: 'X', file: 'a.yml', line: 1, runbookPath: 'does/not/exist.md#x' }]
  const violations = validateRunbookPaths(rules)
  assert.equal(violations.length, 1)
  assert.match(violations[0], /does not exist/)
})

test('runbook_path with a real file but nonexistent anchor is rejected', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'obs-'))
  const file = path.join(dir, 'runbook.md')
  writeFileSync(file, '# Real Heading\n')
  const rules = [{ alertName: 'X', file: 'a.yml', line: 1, runbookPath: `${file}#does-not-exist` }]
  const violations = validateRunbookPaths(rules)
  assert.equal(violations.length, 1)
  assert.match(violations[0], /no matching heading/)
  rmSync(dir, { recursive: true, force: true })
})

test('runbook_path with a real file and real anchor passes', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'obs-'))
  const file = path.join(dir, 'runbook.md')
  writeFileSync(file, '# Real Heading\n')
  const rules = [{ alertName: 'X', file: 'a.yml', line: 1, runbookPath: `${file}#real-heading` }]
  assert.deepEqual(validateRunbookPaths(rules), [])
  rmSync(dir, { recursive: true, force: true })
})

test('a relative link to a nonexistent file is rejected', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'obs-'))
  const file = path.join(dir, 'a.md')
  writeFileSync(file, '[broken](./missing.md)\n')
  const violations = validateRelativeLinks([file])
  assert.equal(violations.length, 1)
  assert.match(violations[0], /does not resolve/)
  rmSync(dir, { recursive: true, force: true })
})

test('real repository runbooks + alerts have no broken links or anchors', () => {
  assert.deepEqual(runAgainstRealRepo(), [])
})
