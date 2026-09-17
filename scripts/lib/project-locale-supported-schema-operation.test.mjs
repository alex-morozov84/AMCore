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

test('accepts only the selected upstream locale in each projection', () => {
  const en = apply(source, 'en')
  const ru = apply(source, 'ru')
  assert.match(en, /safeParse\('en'\)\.success\)\.toBe\(true\)/)
  assert.match(en, /safeParse\('ru'\)\.success\)\.toBe\(false\)/)
  assert.match(en, /safeParse\('de'\)\.success\)\.toBe\(false\)/)
  assert.match(ru, /safeParse\('ru'\)\.success\)\.toBe\(true\)/)
  assert.match(ru, /safeParse\('en'\)\.success\)\.toBe\(false\)/)
  assert.match(ru, /safeParse\('de'\)\.success\)\.toBe\(false\)/)
  assert.match(ru, /safeParse\('EN'\)\.success\)\.toBe\(false\)/)
})

test('fails closed when either upstream expectation is missing or duplicated', () => {
  for (const locale of ['en', 'ru']) {
    const expectation = `expect(supportedLocaleSchema.safeParse('${locale}').success).toBe(true)`
    assert.throws(() => apply(source.replace(expectation, ''), locale), semanticNode)
    assert.throws(
      () => apply(source.replace(expectation, `${expectation}\n    ${expectation}`), locale),
      semanticNode
    )
  }
})

test('rejects mutations that accept the unselected upstream locale', () => {
  assert.doesNotMatch(apply(source, 'en'), /safeParse\('ru'\)\.success\)\.toBe\(true\)/)
  assert.doesNotMatch(apply(source, 'ru'), /safeParse\('en'\)\.success\)\.toBe\(true\)/)
})

function semanticNode(error) {
  return error instanceof PathAlgebraConflictError
}
