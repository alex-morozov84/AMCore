import assert from 'node:assert/strict'
import { test } from 'node:test'

import { OWNERSHIP_CODES, OwnershipError } from './ownership-errors.mjs'
import { buildProjectFactPlan } from './project-fact-plan.mjs'
import { validateProjectLocaleOwnership } from './project-locale-plan.mjs'

const root = process.cwd()

function allSteps(plan) {
  return [
    ...plan.localeSteps,
    ...plan.sharedContentSteps,
    ...plan.storybookSteps,
    ...plan.consoleSteps,
  ]
}

function assertResidualMutation(target, mutate) {
  const plan = buildProjectFactPlan(root, { mode: 'single', locale: 'ru' }, 'admin')
  const mutated = allSteps(plan).map((step) =>
    step.target.endsWith(target) ? { ...step, after: mutate(step.after) } : step
  )
  assert.throws(
    () => validateProjectLocaleOwnership(root, mutated, 'ru'),
    (error) => error instanceof OwnershipError && error.code === OWNERSHIP_CODES.RESIDUAL
  )
}

test('rejects a mutation that restores an impossible production EN branch', () => {
  assertResidualMutation('account-profile-updated.definition.ts', (content) =>
    content.replace(
      "return { title: 'Профиль обновлён'",
      "return locale === 'en' ? { title: 'Profile updated', body: 'English' } : { title: 'Профиль обновлён'"
    )
  )
})

test('rejects a mutation that restores a typed EN notification fixture', () => {
  assertResidualMutation('telegram-content.spec.ts', (content) =>
    content.replace("renderTelegram!(projection, 'ru')", "renderTelegram!(projection, 'en')")
  )
})

test('rejects mutations that restore EN-only default expectations', () => {
  assertResidualMutation('invite.service.spec.ts', (content) =>
    content.replace("expect(data.locale).toBe('ru')", "expect(data.locale).toBe('en')")
  )
  assertResidualMutation('notification-feed.service.spec.ts', (content) =>
    content.replace("title: 'Профиль обновлён'", "title: 'Profile updated'")
  )
  assertResidualMutation('packages/shared/src/schemas/auth.test.ts', (content) =>
    content.replace(
      "supportedLocaleSchema.safeParse('en').success).toBe(false)",
      "supportedLocaleSchema.safeParse('en').success).toBe(true)"
    )
  )
})
