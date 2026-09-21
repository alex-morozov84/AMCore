import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { OWNERSHIP_CODES } from './ownership-errors.mjs'
import { buildProjectLocalePlan, validateProjectLocaleOwnership } from './project-locale-plan.mjs'
import { createRealRepoCopy } from './test-fixture.mjs'

test('catalogue-import diagnostics name the source, target, manifest, and bounded fixes', () => {
  const copy = createRealRepoCopy()
  const file = 'apps/web/src/widgets/forgotten-locale-fixture.test.tsx'
  try {
    writeFileSync(
      path.join(copy.root, file),
      "import messages from '../../messages/en.json'\nvoid messages\n"
    )
    assert.throws(
      () => {
        const plan = buildProjectLocalePlan(copy.root, {
          selected: { locale: true },
          locale: { mode: 'single', base: 'ru' },
        })
        validateProjectLocaleOwnership(copy.root, plan.steps, 'ru')
      },
      (error) => {
        assert.equal(error.code, OWNERSHIP_CODES.MISSING_SEAM)
        assert.match(error.message, new RegExp(`single-locale-projection: "${file}"`))
        assert.match(error.message, /import "apps\/web\/messages\/en\.json"/)
        assert.match(error.message, /use a local fixture or register an owned block/)
        assert.ok(error.message.length < 700)
        return true
      }
    )
  } finally {
    copy.cleanup()
  }
})

test('many missing contributions keep diagnostics bounded', () => {
  const copy = createRealRepoCopy()
  try {
    for (let index = 0; index < 12; index += 1) {
      const file = `apps/web/src/widgets/forgotten-${index}.test.tsx`
      writeFileSync(
        path.join(copy.root, file),
        "import messages from '../../messages/en.json'\nvoid messages\n"
      )
    }
    assert.throws(
      () => {
        const plan = buildProjectLocalePlan(copy.root, {
          selected: { locale: true },
          locale: { mode: 'single', base: 'ru' },
        })
        validateProjectLocaleOwnership(copy.root, plan.steps, 'ru')
      },
      (error) => {
        assert.match(error.message, /12 total violations/)
        assert.ok(error.message.length < 900)
        return true
      }
    )
  } finally {
    copy.cleanup()
  }
})
