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
import { proxyResiduals } from './project-locale-proxy-validation.mjs'

const pathname = 'apps/web/src/proxy.ts'
const source = readFileSync(path.join(process.cwd(), pathname), 'utf8')

const fact = (locale = 'en', topology = 'single-unprefixed') => ({
  kind: 'structural',
  dimension: 'locale',
  path: pathname,
  operationKey: 'locale.proxy-i18n-seam',
  params: { locale, topology },
})

function apply(text = source, locale = 'en') {
  const registry = createProjectStructuralRegistry()
  const [plan] = planStructuralComposition(registry, [fact(locale)])
  return applyStructuralPlan(registry, plan, text)
}

test('retains the proxy security entrypoint and removes only its locale seam', () => {
  for (const locale of ['en', 'ru']) {
    const output = apply(source, locale)
    assert.deepEqual(proxyResiduals(new Map([[pathname, output]])), [])
    assert.doesNotMatch(output, /next-intl|handleI18nRouting/)
    assert.match(output, /buildCspDirectives/)
    assert.match(output, /generateNonce/)
    assert.match(output, /request: \{\s*headers: request\.headers/)
  }
})

test('preserves unrelated security logic and the matcher', () => {
  const output = apply()
  for (const value of [
    'CSP_ENFORCE_HEADER',
    'CSP_REPORT_ONLY_HEADER',
    'NONCE_REQUEST_HEADER',
    'CSP_REPORT_ENDPOINT_PATH',
    'request.nextUrl.origin',
  ]) {
    assert.match(output, new RegExp(value))
  }
  assert.match(output, /matcher: \['\/\(\(\?!api\|_next\|_vercel\|\.\*\\\\\.\.\*\)\.\*\)'\]/)
})

test('fails closed on missing or duplicate locale anchors', () => {
  assert.throws(() =>
    apply(source.replace("import createMiddleware from 'next-intl/middleware'\n", ''))
  )
  assert.throws(() =>
    apply(source.replace('const response = handleI18nRouting(request)', 'const response = request'))
  )
  assert.throws(() => apply(`${source}\nconst handleI18nRouting = createMiddleware(routing)\n`))
})

test('rejects unsupported locale or topology params', () => {
  const registry = createProjectStructuralRegistry()
  for (const invalid of [fact('de'), fact('en', 'locale-prefixed')]) {
    assert.throws(
      () => planStructuralComposition(registry, [invalid]),
      (error) =>
        error instanceof PathAlgebraConflictError &&
        error.code === CONFLICT_CODES.INVALID_OPERATION_PARAMS
    )
  }
})

test('semantic validation rejects every security and ownership mutation', () => {
  const output = apply()
  const mutations = [
    undefined,
    output.replace('headers: request.headers', 'headers: new Headers()'),
    output.replace('response.headers.set(cspHeaderName, cspHeaderValue)', ''),
    output.replace("'Reporting-Endpoints'", "'Removed-Reporting-Endpoints'"),
    output.replace('_vercel', '_changed'),
    `${output}\n// next-intl/middleware\n`,
  ]
  for (const mutation of mutations) {
    const contents = mutation === undefined ? new Map() : new Map([[pathname, mutation]])
    assert.notDeepEqual(proxyResiduals(contents), [])
  }
})
