import { OWNERSHIP_CODES, ownershipError } from './ownership-errors.mjs'

const REQUEST_PATH = 'apps/web/src/i18n/request.ts'

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

export function assertLocaleSemanticProjection(locale, contents) {
  const residuals = requestResiduals(locale, contents.get(REQUEST_PATH) ?? '')
  for (const contract of emailContracts) {
    residuals.push(...emailResiduals(locale, contract, contents.get(contract.path) ?? ''))
  }
  if (!residuals.length) return
  throw ownershipError(
    OWNERSHIP_CODES.RESIDUAL,
    `locale semantic postconditions failed: ${residuals.join(', ')}`,
    residuals.map((item) => item.split(':')[0])
  )
}
