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
import { localeIntentionalDeltas } from './project-locale-intentional-deltas.mjs'

const pathname = 'packages/shared/src/lib/frontend-url.test.ts'
const source = readFileSync(path.join(process.cwd(), pathname), 'utf8')

function apply(text, locale) {
  const registry = createProjectStructuralRegistry()
  const facts = [
    {
      kind: 'structural',
      dimension: 'locale',
      path: pathname,
      operationKey: 'locale.frontend-url-test',
      params: { locale },
    },
  ]
  const [plan] = planStructuralComposition(registry, facts)
  return applyStructuralPlan(registry, plan, text)
}

test('uses supported typed fixtures for both locale projections', () => {
  const en = apply(source, 'en')
  const ru = apply(source, 'ru')
  assert.match(en, /localePathPrefix\('en', \['en', 'ru'\]\)\)\.toBe\('\/en'\)/)
  assert.match(en, /localePathPrefix\('en', \['en'\]\)\)\.toBe\(''\)/)
  assert.match(ru, /localePathPrefix\('ru', \['en', 'ru'\]\)\)\.toBe\('\/ru'\)/)
  assert.match(ru, /localePathPrefix\('ru', \['ru'\]\)\)\.toBe\(''\)/)
  assert.doesNotMatch(ru, /localePathPrefix\('en',/)
})

test('preserves unrelated imports, declarations, tests, and comments', () => {
  const augmented = `// retained sentinel\n${source}\nconst untouched = true\n`
  const output = apply(augmented, 'ru')
  assert.match(output, /import \{ describe, expect, it \} from 'vitest'/)
  assert.match(output, /describe\('localizedFrontendUrl'/)
  assert.match(output, /AMCore upstream's own SUPPORTED_LOCALES/)
  assert.match(output, /const untouched = true/)
})

test('fails closed for missing and duplicated suite anchors', () => {
  const missing = source.replace("describe('localePathPrefix'", "describe('drifted'")
  const duplicated = `${source}\ndescribe('localePathPrefix', () => {})\n`
  assert.throws(() => apply(missing, 'ru'), semanticNode)
  assert.throws(() => apply(duplicated, 'ru'), semanticNode)
})

test('rejects unsupported locale params at registry validation', () => {
  assert.throws(() => apply(source, 'de'), invalidParams)
})

test('names the frontend fixture as an RU-only parity delta', () => {
  const request = 'apps/web/src/i18n/request.ts'
  const emailRoot = 'apps/api/src/infrastructure/email/templates'
  assert.deepEqual(localeIntentionalDeltas('en'), [request])
  assert.deepEqual(localeIntentionalDeltas('ru'), [
    request,
    `${emailRoot}/email-verification.integration.spec.ts`,
    `${emailRoot}/org-invite.integration.spec.ts`,
    `${emailRoot}/password-reset.integration.spec.ts`,
    pathname,
  ])
})

function semanticNode(error) {
  return (
    error instanceof PathAlgebraConflictError &&
    [CONFLICT_CODES.MISSING_SEMANTIC_NODE, CONFLICT_CODES.AMBIGUOUS_SEMANTIC_NODE].includes(
      error.code
    )
  )
}

function invalidParams(error) {
  return (
    error instanceof PathAlgebraConflictError &&
    error.code === CONFLICT_CODES.INVALID_OPERATION_PARAMS
  )
}
