// Runs against a disposable copy of the real repo. The exact new import
// position was verified empirically (a real `eslint --fix` run against a
// scratch copy, captured in this test as the expected output) rather than
// guessed — simple-import-sort's actual ordering here is not the plain
// alphabetical order it might look like.
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EngineError } from './actions.mjs'
import { createRealRepoCopy } from './test-fixture.mjs'
import { buildWebNavLinkSteps } from './project-plan-web-nav-links.mjs'

let copy

afterEach(() => {
  copy?.cleanup()
  copy = undefined
})

describe('buildWebNavLinkSteps (against a real repo copy)', () => {
  test('moves the Link import to directly before next-intl, in every file', () => {
    copy = createRealRepoCopy()
    const steps = buildWebNavLinkSteps(copy.root)
    assert.equal(steps.length, 7)
    for (const step of steps) step.write()

    for (const step of steps) {
      const content = readFileSync(step.target, 'utf8')
      assert.doesNotMatch(content, /@\/i18n\/navigation/, step.target)
      assert.match(
        content,
        /import Link from 'next\/link'\nimport \{ useTranslations \} from 'next-intl'\n/,
        step.target
      )
    }
  })

  test("fails closed if re-run after the swap (this is a one-time structural transform, not init:brand -- init:project's reinitialize guard is what prevents a real rerun, not this step)", () => {
    copy = createRealRepoCopy()
    for (const step of buildWebNavLinkSteps(copy.root)) step.write()

    assert.throws(() => buildWebNavLinkSteps(copy.root), EngineError)
  })
})
