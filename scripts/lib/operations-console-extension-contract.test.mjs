import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { operationsConsoleOwnership } from './operations-console-ownership.mjs'
import { validateOwnership } from './ownership-validate.mjs'
import { createRealRepoCopy } from './test-fixture.mjs'

function withCopy(run) {
  const copy = createRealRepoCopy()
  try {
    return run(copy.root)
  } finally {
    copy.cleanup()
  }
}

function write(root, pathname, content) {
  const target = path.join(root, pathname)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
}

test('forgotten shared Console contribution gives an actionable registration diagnostic', () =>
  withCopy((root) => {
    const pathname = 'apps/web/src/shared/lib/forgotten-console-sidebar.ts'
    write(root, pathname, 'export const item = ADMIN_CONSOLE_CONFIG.slug\n')
    assert.throws(
      () => validateOwnership(root, operationsConsoleOwnership),
      (error) => {
        assert.equal(error.code, 'missing-declared-seam')
        assert.match(error.message, /operations-console/u)
        assert.match(error.message, /forgotten-console-sidebar/u)
        assert.match(error.message, /ADMIN_CONSOLE_CONFIG/u)
        assert.match(error.message, /owned block, config field, or structural operation/u)
        return true
      }
    )
  }))

test('novel unmarked meaning remains an explicit author and reviewer boundary', () =>
  withCopy((root) => {
    write(
      root,
      'docs/backend/novel-semantics.md',
      'This prose introduces a new optional product surface without a registered marker.\n'
    )
    assert.doesNotThrow(() => validateOwnership(root, operationsConsoleOwnership))
  }))
