import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { CONFLICT_CODES, PathAlgebraConflictError } from './path-algebra-errors.mjs'
import {
  applyStructuralPlan,
  planStructuralComposition,
} from './path-algebra-structural-compose.mjs'
import { createProjectStructuralRegistry } from './project-content-materializer.mjs'

const fixtures = {
  verification: 'email-verification.integration.spec.ts',
  invite: 'org-invite.integration.spec.ts',
  reset: 'password-reset.integration.spec.ts',
}

function pathname(template) {
  return `apps/api/src/infrastructure/email/templates/${fixtures[template]}`
}

function source(template) {
  return readFileSync(path.join(process.cwd(), pathname(template)), 'utf8')
}

function apply(text, template, locale) {
  const registry = createProjectStructuralRegistry()
  const [plan] = planStructuralComposition(registry, [
    {
      kind: 'structural',
      dimension: 'locale',
      path: pathname(template),
      operationKey: 'locale.email-template-test',
      params: { locale, template },
    },
  ])
  return applyStructuralPlan(registry, plan, text)
}

test('keeps concrete English defaults in the EN projection', () => {
  const verification = apply(source('verification'), 'verification', 'en')
  const invite = apply(source('invite'), 'invite', 'en')
  const reset = apply(source('reset'), 'reset', 'en')
  assert.match(verification, /24 hours/)
  assert.match(verification, /Verify your email/)
  assert.match(invite, /Sign in to accept the invitation/)
  assert.match(invite, /Create an account to join/)
  assert.match(reset, /Password Reset/)
  assert.match(reset, /60 minutes/)
})

test('uses independent concrete Russian expectations in the RU projection', () => {
  const verification = apply(source('verification'), 'verification', 'ru')
  const invite = apply(source('invite'), 'invite', 'ru')
  const reset = apply(source('reset'), 'reset', 'ru')
  assert.match(verification, /Подтвердите ваш email/)
  assert.match(verification, /Подтвердить email/)
  assert.match(verification, /24 часа/)
  assert.match(invite, /Войти и принять приглашение/)
  assert.match(invite, /Создать аккаунт и присоединиться/)
  assert.match(reset, /Сброс пароля/)
  assert.match(reset, /60 минут/)
  for (const output of [verification, invite, reset]) {
    assert.doesNotMatch(output, /emailMessages|formatMessage/)
  }
})

test('preserves URL, props, HTML, security, and unrelated comments', () => {
  const verification = apply(`// retained\n${source('verification')}`, 'verification', 'ru')
  const invite = apply(source('invite'), 'invite', 'ru')
  const reset = apply(source('reset'), 'reset', 'ru')
  assert.match(verification, /raw-token-xyz/)
  assert.match(verification, /Alexander/)
  assert.match(verification, /<!DOCTYPE html/)
  assert.match(verification, /\/\/ retained/)
  assert.match(invite, /raw-token-123/)
  assert.match(invite, /alex@example\.com/)
  assert.match(reset, /raw-token-abc/)
  assert.match(reset, /unrequested resets/)
  assert.match(reset, /<table/)
})

test('fails closed for missing and duplicated default-expectation anchors', () => {
  const original = source('verification')
  const title = 'should render in the base locale (English) by default'
  const missing = original.replace(title, 'drifted title')
  const duplicate = `${original}\nit('${title}', async () => {})\n`
  assert.throws(() => apply(missing, 'verification', 'ru'), semanticNode)
  assert.throws(() => apply(duplicate, 'verification', 'ru'), semanticNode)
})
function semanticNode(error) {
  return (
    error instanceof PathAlgebraConflictError &&
    [CONFLICT_CODES.MISSING_SEMANTIC_NODE, CONFLICT_CODES.AMBIGUOUS_SEMANTIC_NODE].includes(
      error.code
    )
  )
}
