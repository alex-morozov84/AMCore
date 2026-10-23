import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const detail = 'apps/web/src/_pages/console/UserDetailPage'
const journey = 'apps/web/e2e/console-real-stack/login-diagnostics.ts'
const retained = [
  'apps/api/src/core/admin/admin-login-diagnostics.ts',
  'apps/api/src/core/admin/admin-login-diagnostics.spec.ts',
  'apps/api/src/core/admin/admin-detail.service.ts',
  'apps/api/src/core/admin/dto/admin-detail.dto.ts',
  'apps/api/src/core/auth/auth.service.ts',
  'packages/shared/src/schemas/admin-detail.ts',
  'packages/shared/src/schemas/admin-detail.test.ts',
]
const removed = [
  detail,
  journey,
  'apps/web/e2e/real-stack/admin-users.spec.ts',
  'scripts/stand/login-diagnostics-fixture.mjs',
  'scripts/stand/login-diagnostics-fixture.test.mjs',
]
const read = (root, name) => readFileSync(path.join(root, name), 'utf8')

function checkAudit(source, output) {
  const name = 'docs/operations/audit-log.md'
  const paragraph = read(source, name).split('Raw\n')[1].split('\n\nFilters')[0]
  assert.ok(paragraph.includes('a `SESSION` event') || paragraph.includes('A `SESSION` event'))
  assert.ok(read(output, name).includes(paragraph), 'retain the precise API redaction paragraph')
}

function checkRemoved(output, locale) {
  for (const name of removed) assert.equal(existsSync(path.join(output, name)), false, name)
  for (const name of ['scripts/stand/preview.mjs', 'docs/operations/local-stands.md', 'README.md'])
    assert.doesNotMatch(read(output, name), /login-diagnostics|loginDiagnosticsFixture/)
  for (const code of locale ? [locale] : ['en', 'ru']) {
    const catalogue = JSON.parse(read(output, `apps/web/messages/${code}.json`))
    assert.equal('console' in catalogue, false)
  }
  assert.doesNotMatch(read(output, 'docs/operations/audit-log.md'), /operations-console\//)
}

function checkLocale(output, locale) {
  const other = locale === 'en' ? 'ru' : 'en'
  const fixture = read(output, `${detail}/UserLoginFacts.test.tsx`)
  assert.match(fixture, new RegExp(`const catalogues = \\{ ${locale} \\}`))
  assert.match(fixture, new RegExp(`import ${locale} from '.*/messages/${locale}\\.json'`))
  assert.doesNotMatch(fixture, new RegExp(`/messages/${other}\\.json`))
  assert.doesNotMatch(fixture, /translations\('(en|ru)'\)|locale === 'en'/)
  const copy = JSON.parse(read(output, `apps/web/messages/${locale}.json`)).console
  const text = read(output, journey)
  for (const label of [
    copy.detail.userTitle,
    copy.detail.login.configured,
    copy.detail.login.confirmations,
    copy.detail.login.securityEvents,
    copy.detail.login.access,
    copy.detail.backUsers,
    copy.auditTitle,
  ])
    assert.ok(text.includes(`'${label}'`), label)
  assert.match(text, /name: 'Diagnostic target'/)
  assert.match(text, /Google, GitHub, Apple, Telegram/)
  assert.match(text, /actorType=USER/)
  assert.match(text, /headers: \{ RSC: '1' \}/)
  assert.equal([...text.matchAll(/expectNoAxeViolations\(page\)/g)].length, 2)
  if (locale === 'ru') {
    assert.doesNotMatch(text, /Fresh authentication|User system role changed|Last sign-in/)
    assert.match(text, /Отзыв сесси\[ий\] пользователя/)
  }
  for (const name of [
    'apps/web/e2e/real-stack/admin-users.spec.ts',
    'apps/web/e2e/console-real-stack/users.spec.ts',
  ]) {
    const caller = read(output, name)
    assert.doesNotMatch(caller, /\/en\b|\\\/en\b/)
    assert.match(caller, /inspectLoginDiagnostics\(/)
    if (locale === 'ru') assert.doesNotMatch(caller, /name: \/users\/i|name: \/search users\/i/)
  }
}

export function checkLoginDiagnostics(source, output, flags) {
  for (const name of retained) assert.equal(read(output, name), read(source, name), name)
  checkAudit(source, output)
  const locale = flags.includes('--mode=single')
    ? flags.includes('--locale=ru')
      ? 'ru'
      : 'en'
    : undefined
  if (flags.includes('--admin-console=disabled')) return checkRemoved(output, locale)
  for (const name of removed) assert.ok(existsSync(path.join(output, name)), name)
  for (const name of ['scripts/stand/preview.mjs', 'docs/operations/local-stands.md'])
    assert.match(read(output, name), /login-diagnostics/)
  if (locale) checkLocale(output, locale)
  else {
    assert.equal(
      read(output, `${detail}/UserLoginFacts.test.tsx`),
      read(source, `${detail}/UserLoginFacts.test.tsx`)
    )
    assert.equal(read(output, journey), read(source, journey))
  }
}
