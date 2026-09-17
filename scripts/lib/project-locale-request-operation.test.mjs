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

const pathname = 'apps/web/src/i18n/request.ts'
const source = readFileSync(path.join(process.cwd(), pathname), 'utf8')
const fact = (locale) => ({
  kind: 'structural',
  dimension: 'locale',
  path: pathname,
  operationKey: 'locale.request-config',
  params: { locale },
})

function plan(locale = 'en') {
  const registry = createProjectStructuralRegistry()
  return { registry, plan: planStructuralComposition(registry, [fact(locale)])[0] }
}

function apply(text, locale = 'en') {
  const prepared = plan(locale)
  return applyStructuralPlan(prepared.registry, prepared.plan, text)
}

test('statically imports exactly the selected catalogue for en and ru', () => {
  for (const locale of ['en', 'ru']) {
    const output = apply(source, locale)
    const other = locale === 'en' ? 'ru' : 'en'
    assert.match(output, new RegExp(`import messages from '../../messages/${locale}\\.json'`))
    assert.doesNotMatch(output, /\bimport\s*\(/)
    assert.doesNotMatch(output, new RegExp(`messages/${other}\\.json`))
    assert.match(output, /locale: DEFAULT_LOCALE/)
    assert.match(output, /\bmessages,/)
  }
})

test('declares separate semantic claims for import, dynamic removal, and use', () => {
  const registry = createProjectStructuralRegistry()
  const claims = registry.get('locale.request-config').deriveSemanticWrites({ locale: 'ru' })
  assert.deepEqual(claims, [
    { location: 'ts:request-config:catalogue-import', value: '../../messages/ru.json' },
    { location: 'ts:request-config:dynamic-catalogue-import', value: 'absent' },
    { location: 'ts:request-config:messages-source', value: 'messages' },
    { location: 'ts:request-config:runtime-locale', value: 'DEFAULT_LOCALE' },
  ])
})

test('preserves unrelated imports, declarations, and comments', () => {
  const augmented = `// retained sentinel\nimport { keep } from './keep'\n${source}\nconst untouched = keep\n`
  const output = apply(augmented)
  assert.match(output, /\/\/ retained sentinel/)
  assert.match(output, /import \{ keep \} from '\.\/keep'/)
  assert.match(output, /const untouched = keep/)
  assert.match(output, /Shared format definitions/)
})

test('fails closed when the dynamic import is missing or duplicated', () => {
  const missing = source.replace('(await import(`../../messages/${locale}.json`)).default', '{}')
  const duplicate = `${source}\nconst duplicate = import(\`../../messages/\${locale}.json\`)\n`
  assert.throws(() => apply(missing), semanticNode(CONFLICT_CODES.MISSING_SEMANTIC_NODE))
  assert.throws(() => apply(duplicate), semanticNode(CONFLICT_CODES.AMBIGUOUS_SEMANTIC_NODE))
})

test('fails closed when the request-config export is ambiguous', () => {
  const ambiguous = `${source}\nexport = getRequestConfig(async () => ({ locale: 'en', messages: {} }))\n`
  assert.throws(() => apply(ambiguous), semanticNode(CONFLICT_CODES.AMBIGUOUS_SEMANTIC_NODE))
})

test('rejects unsupported locale params at registry validation', () => {
  const registry = createProjectStructuralRegistry()
  assert.throws(
    () => planStructuralComposition(registry, [fact('de')]),
    (error) =>
      error instanceof PathAlgebraConflictError &&
      error.code === CONFLICT_CODES.INVALID_OPERATION_PARAMS
  )
})
function semanticNode(code) {
  return (error) => error instanceof PathAlgebraConflictError && error.code === code
}
