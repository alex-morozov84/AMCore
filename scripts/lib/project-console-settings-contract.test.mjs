import assert from 'node:assert/strict'
import { test } from 'node:test'

import { e2eRouteResiduals } from './project-locale-e2e-route-validation.mjs'
import { e2eUiResiduals } from './project-locale-e2e-ui-validation.mjs'

const file = 'apps/web/e2e/real-stack/storage-runtime-settings.spec.ts'
const unrelated = 'apps/web/e2e/real-stack/login.spec.ts'

test('locale postconditions exempt only an explicitly deleted verification file', () => {
  for (const residuals of [
    (removed) => e2eRouteResiduals(new Map(), removed),
    (removed) => e2eUiResiduals('ru', new Map(), removed),
  ]) {
    assert.ok(residuals(new Set()).some((error) => error.startsWith(file)))
    const errors = residuals(new Set([file]))
    assert.equal(
      errors.some((error) => error.startsWith(file)),
      false
    )
    assert.ok(errors.some((error) => error.startsWith(unrelated)))
  }
})
