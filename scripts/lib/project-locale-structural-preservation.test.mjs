import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  applyStructuralPlan,
  planStructuralComposition,
} from './path-algebra-structural-compose.mjs'
import { createProjectStructuralRegistry } from './project-content-materializer.mjs'

const SENTINEL = `  // unrelated-suite-comment
  it('keeps an unrelated sibling', () => {
    expect('unrelated-suite-value').toBe('unrelated-suite-value')
  })
`

function apply(path, operationKey, params, source = readFileSync(path, 'utf8')) {
  const registry = createProjectStructuralRegistry()
  const [plan] = planStructuralComposition(registry, [
    { kind: 'structural', dimension: 'locale', path, operationKey, params },
  ])
  return applyStructuralPlan(registry, plan, source)
}

function beforeFinalSuite(source) {
  const end = source.lastIndexOf('\n})')
  assert.notEqual(end, -1)
  return `${source.slice(0, end)}\n${SENTINEL}${source.slice(end)}`
}

const suiteCases = [
  {
    path: 'apps/api/src/infrastructure/email/messages.spec.ts',
    key: 'locale.api-locale-suite',
    params: { locale: 'ru', variant: 'messages' },
  },
  {
    path: 'apps/api/src/infrastructure/email/templates/notification.integration.spec.ts',
    key: 'locale.api-locale-suite',
    params: { locale: 'ru', variant: 'notification' },
  },
  {
    path: 'apps/api/src/infrastructure/email/templates/render-robustness.integration.spec.ts',
    key: 'locale.render-robustness-test',
    params: { locale: 'ru' },
  },
  {
    path: 'apps/web/src/i18n/messages.test.ts',
    key: 'locale.web-messages-test',
    params: { locale: 'ru' },
  },
  {
    path: 'apps/api/src/infrastructure/email/templates/email-verification.integration.spec.ts',
    key: 'locale.email-template-test',
    params: { locale: 'ru', template: 'verification' },
  },
  {
    path: 'apps/api/src/infrastructure/email/templates/welcome.integration.spec.ts',
    key: 'locale.welcome-email-test',
    params: { locale: 'ru' },
  },
  {
    path: 'apps/api/src/core/notifications/definitions/account-password-changed.definition.spec.ts',
    key: 'locale.api-fixture',
    params: { locale: 'ru', variant: 'password-definition' },
  },
]

test('root layout retains unrelated statement, comment, and JSX siblings', () => {
  const path = 'apps/web/src/app/[locale]/layout.tsx'
  const source = readFileSync(path, 'utf8')
    .replace(
      '  return (',
      "  // unrelated-layout-comment\n  const unrelatedLayout = 'kept-byte-for-byte'\n\n  return ("
    )
    .replace(
      '            <Providers nonce={nonce}>{children}</Providers>',
      '            {/* unrelated-jsx-comment */}\n            <aside data-sentinel="kept-byte-for-byte" />\n            <Providers nonce={nonce}>{children}</Providers>'
    )
  const output = apply(path, 'locale.root-layout', { locale: 'ru' }, source)
  assert.match(
    output,
    /\/\/ unrelated-layout-comment\n[ ]{2}const unrelatedLayout = 'kept-byte-for-byte'/
  )
  assert.match(
    output,
    /\{\/\* unrelated-jsx-comment \*\/\}\n[ ]{12}<aside data-sentinel="kept-byte-for-byte" \/>/
  )
})

test('suite operations retain unrelated sibling tests and comments', () => {
  for (const fixture of suiteCases) {
    const output = apply(
      fixture.path,
      fixture.key,
      fixture.params,
      beforeFinalSuite(readFileSync(fixture.path, 'utf8'))
    )
    assert.match(output, /\/\/ unrelated-suite-comment/)
    assert.match(output, /it\('keeps an unrelated sibling'/)
    assert.match(output, /'unrelated-suite-value'\)\.toBe\('unrelated-suite-value'/)
  }
})

test('both frontend URL suite shapes retain unrelated sibling tests', () => {
  const path = 'packages/shared/src/lib/frontend-url.test.ts'
  const source = beforeFinalSuite(
    readFileSync(path, 'utf8').replace(
      "\n})\n\ndescribe('localePathPrefix'",
      `\n${SENTINEL}})\n\ndescribe('localePathPrefix'`
    )
  )
  const output = apply(path, 'locale.frontend-url-test', { locale: 'ru' }, source)
  assert.equal(output.match(/keeps an unrelated sibling/g)?.length, 2)
})
