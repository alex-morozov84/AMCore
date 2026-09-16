import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { PathAlgebraConflictError } from './path-algebra-errors.mjs'
import {
  applyStructuralPlan,
  planStructuralComposition,
} from './path-algebra-structural-compose.mjs'
import { createProjectStructuralRegistry } from './project-content-materializer.mjs'

const pathname = 'packages/shared/src/schemas/auth.test.ts'
const source = readFileSync(path.join(process.cwd(), pathname), 'utf8')

function apply(text, locale) {
  const registry = createProjectStructuralRegistry()
  const facts = [
    {
      kind: 'structural',
      dimension: 'locale',
      path: pathname,
      operationKey: 'locale.supported-schema-test',
      params: { locale },
    },
  ]
  const [plan] = planStructuralComposition(registry, facts)
  return applyStructuralPlan(registry, plan, text)
}

test('rejects the unselected English locale only in RU projection', () => {
  assert.equal(apply(source, 'en'), source)
  const ru = apply(source, 'ru')
  assert.match(ru, /safeParse\('ru'\)\.success\)\.toBe\(true\)/)
  assert.match(ru, /safeParse\('en'\)\.success\)\.toBe\(false\)/)
  assert.match(ru, /safeParse\('de'\)\.success\)\.toBe\(false\)/)
  assert.match(ru, /safeParse\('EN'\)\.success\)\.toBe\(false\)/)
})

test('fails closed when the English expectation is missing or duplicated', () => {
  const expectation = "expect(supportedLocaleSchema.safeParse('en').success).toBe(true)"
  assert.throws(() => apply(source.replace(expectation, ''), 'ru'), semanticNode)
  assert.throws(
    () => apply(source.replace(expectation, `${expectation}\n    ${expectation}`), 'ru'),
    semanticNode
  )
})

function semanticNode(error) {
  return error instanceof PathAlgebraConflictError
}
