import { OWNERSHIP_CODES, ownershipError } from './ownership-errors.mjs'
import { ruNarrowingResiduals } from './project-locale-ru-narrowing-validation.mjs'
import { readPrismaLocaleDefault } from './project-locale-prisma-default-operation.mjs'
import { readSqlLocaleDefault } from './project-locale-sql-default-operation.mjs'
import { e2eRouteResiduals } from './project-locale-e2e-route-validation.mjs'
import { proxyResiduals } from './project-locale-proxy-validation.mjs'
import { e2eUiResiduals } from './project-locale-e2e-ui-validation.mjs'

const REQUEST_PATH = 'apps/web/src/i18n/request.ts'
const FRONTEND_URL_TEST = 'packages/shared/src/lib/frontend-url.test.ts'
const CONSTANTS_PATH = 'packages/shared/src/constants/index.ts'
const PRISMA_PATH = 'apps/api/prisma/user.prisma'
const SQL_PATH =
  'apps/api/prisma/migrations/20260801103725_default_locale_en_timezone_utc/migration.sql'
const AUTH_SCHEMA_TEST = 'packages/shared/src/schemas/auth.test.ts'

const emailContracts = [
  {
    path: 'apps/api/src/infrastructure/email/templates/email-verification.integration.spec.ts',
    en: ['24 hours', 'Verify your email', 'Verify Email'],
    ru: ['24 часа', 'Подтвердите ваш email', 'Подтвердить email'],
  },
  {
    path: 'apps/api/src/infrastructure/email/templates/org-invite.integration.spec.ts',
    en: ['Sign in to accept the invitation', 'Create an account to join'],
    ru: ['Войти и принять приглашение', 'Создать аккаунт и присоединиться'],
  },
  {
    path: 'apps/api/src/infrastructure/email/templates/password-reset.integration.spec.ts',
    en: ['Password Reset', '60 minutes'],
    ru: ['Сброс пароля', '60 минут'],
  },
]

function positiveExpectation(value) {
  return `expect(html).toContain('${value}')`
}

function requestResiduals(locale, content) {
  const selected = `../../messages/${locale}.json`
  const other = `../../messages/${locale === 'en' ? 'ru' : 'en'}.json`
  const imports = [...content.matchAll(/import messages from ['"]([^'"]+)['"]/g)]
  return [
    ...(imports.length === 1 && imports[0][1] === selected ? [] : ['selected static import']),
    ...(content.includes('import(') ? ['dynamic catalogue import'] : []),
    ...(content.includes(other) ? ['unselected catalogue reference'] : []),
    ...(content.includes('locale: DEFAULT_LOCALE') ? [] : ['DEFAULT_LOCALE request result']),
    ...(content.includes('  messages,') ? [] : ['imported messages request result']),
  ].map((item) => `${REQUEST_PATH}:${item}`)
}

function emailResiduals(locale, contract, content) {
  const other = locale === 'en' ? 'ru' : 'en'
  const missing = contract[locale]
    .filter((value) => !content.includes(positiveExpectation(value)))
    .map((value) => `${contract.path}:missing ${value}`)
  const stale = contract[other]
    .filter((value) => content.includes(positiveExpectation(value)))
    .map((value) => `${contract.path}:stale ${value}`)
  return [...missing, ...stale]
}

function frontendUrlResiduals(locale, content) {
  const multi = `localePathPrefix('${locale}', ['en', 'ru'])).toBe('/${locale}')`
  const single = `localePathPrefix('${locale}', ['${locale}'])).toBe('')`
  const other = locale === 'en' ? 'ru' : 'en'
  return [
    ...(content.includes(multi) ? [] : [`${FRONTEND_URL_TEST}:multi fixture`]),
    ...(content.includes(single) ? [] : [`${FRONTEND_URL_TEST}:single fixture`]),
    ...(content.includes(`localePathPrefix('${other}',`)
      ? [`${FRONTEND_URL_TEST}:unsupported typed locale`]
      : []),
  ]
}

function declaredDefault(content) {
  const matches = [...content.matchAll(/export const DEFAULT_LOCALE(?:: [^=]+)? = '([^']+)'/g)]
  return matches.length === 1 ? matches[0][1] : undefined
}

function databaseDefaultResiduals(locale, contents) {
  const defaults = {
    shared: declaredDefault(contents.get(CONSTANTS_PATH) ?? ''),
    prisma: readPrismaLocaleDefault(contents.get(PRISMA_PATH) ?? ''),
    sql: readSqlLocaleDefault(contents.get(SQL_PATH) ?? ''),
  }
  return Object.entries(defaults)
    .filter(([, value]) => value !== locale)
    .map(([source, value]) => `${source} locale default ${String(value)} != ${locale}`)
}

function supportedSchemaResiduals(locale, content) {
  const other = locale === 'en' ? 'ru' : 'en'
  const required = [
    `supportedLocaleSchema.safeParse('${locale}').success).toBe(true)`,
    `supportedLocaleSchema.safeParse('${other}').success).toBe(false)`,
    "supportedLocaleSchema.safeParse('de').success).toBe(false)",
  ]
  return required
    .filter((expectation) => !content.includes(expectation))
    .map((expectation) => `${AUTH_SCHEMA_TEST}:missing ${expectation}`)
}

export function assertLocaleSemanticProjection(locale, contents) {
  const residuals = requestResiduals(locale, contents.get(REQUEST_PATH) ?? '')
  for (const contract of emailContracts) {
    residuals.push(...emailResiduals(locale, contract, contents.get(contract.path) ?? ''))
  }
  residuals.push(...frontendUrlResiduals(locale, contents.get(FRONTEND_URL_TEST) ?? ''))
  residuals.push(...databaseDefaultResiduals(locale, contents))
  residuals.push(...supportedSchemaResiduals(locale, contents.get(AUTH_SCHEMA_TEST) ?? ''))
  residuals.push(...e2eRouteResiduals(contents))
  residuals.push(...proxyResiduals(contents))
  residuals.push(...e2eUiResiduals(locale, contents))
  residuals.push(...ruNarrowingResiduals(locale, contents))
  if (!residuals.length) return
  throw ownershipError(
    OWNERSHIP_CODES.RESIDUAL,
    `locale semantic postconditions failed: ${residuals.join(', ')}`,
    residuals.map((item) => item.split(':')[0])
  )
}
