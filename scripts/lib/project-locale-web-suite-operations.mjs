import ts from 'typescript'

import { findAllNodes } from './path-algebra-ast-query.mjs'
import { absent, claim, testCall } from './project-locale-ast-helpers.mjs'
import {
  localeDefaults,
  removeTests,
  replaceLiteral,
  retainWebCatalogue,
} from './project-locale-web-suite-core.mjs'
import { fixtureParams, singleCatalogueFixture } from './project-locale-catalogue-fixtures.mjs'

const variants = ['oauth-alert', 'zod', 'api-alert', 'fallback']
const paramsSchema = (params) =>
  params !== null &&
  typeof params === 'object' &&
  Object.keys(params).length === 2 &&
  ['en', 'ru'].includes(params.locale) &&
  variants.includes(params.variant)

const COPY = {
  'oauth-alert': {
    'The sign-in link expired. Please try again.': 'Ссылка для входа устарела. Попробуйте снова.',
  },
  zod: {
    'This field is required.': 'Заполните это поле.',
    'Enter a valid email address.': 'Введите корректный email.',
    'Must be at least 8 characters.': 'Минимум 8 символов.',
    'Choose one of the allowed values.': 'Выберите одно из допустимых значений.',
    'Unknown scope action.': 'Неизвестное действие в скоупе.',
    'This value is not valid.': 'Значение недопустимо.',
  },
  'api-alert': {
    'Incorrect email or password.': 'Неверный email или пароль.',
    'Something went wrong. Please try again.': 'Что-то пошло не так. Попробуйте снова.',
    'Reference: abc-123': 'Идентификатор запроса: abc-123',
  },
  fallback: {
    'This is temporarily unavailable. Please try again.':
      'Временно недоступно. Пожалуйста, попробуйте ещё раз.',
    Retry: 'Повторить',
  },
}

const NETWORK_COPY = {
  en: "Can't reach the server. Check your connection and try again.",
  ru: 'Не удаётся связаться с сервером. Проверьте соединение и попробуйте снова.',
}

const REMOVED = {
  'oauth-alert': ['translates the same code into the active locale'],
  zod: ['does not depend on Zod global locale state'],
  'api-alert': ['translates the same code into the active locale'],
  fallback: ['renders the localized message in ru'],
}

function removeZodAssertions(model, ctx) {
  const duplicateRussian = findAllNodes(
    model,
    (node) =>
      ts.isExpressionStatement(node) &&
      node.getText().startsWith('expect(') &&
      node.getText().includes('firstMessage') &&
      node.getText().includes("'ru'")
  ).filter((node) => !model.isRemoved(node))
  if (duplicateRussian.length !== 3) {
    throw new Error(`expected three cross-locale zod assertions, found ${duplicateRussian.length}`)
  }
  for (const statement of duplicateRussian) model.removeNode(statement, ctx)
}

function rewriteNetworkError(model, locale, ctx) {
  const network = findAllNodes(
    model,
    (node) =>
      ts.isExpressionStatement(node) &&
      node.getText().startsWith('expect(') &&
      node.getText().includes("Can't reach the server")
  )
  if (network.length !== 1) throw new Error('network-error assertion is missing or ambiguous')
  model.replaceNode(
    network[0],
    `expect(screen.getByText("${NETWORK_COPY[locale]}")).toBeInTheDocument()`,
    ctx
  )
}

function rewriteRussian(model, variant, ctx) {
  for (const [before, after] of Object.entries(COPY[variant])) {
    replaceLiteral(model, before, after, ctx)
  }
  replaceLiteral(model, 'en', 'ru', ctx)
  if (variant === 'fallback') {
    replaceLiteral(
      model,
      'renders the localized temporarily-unavailable message and retry control (en)',
      'renders the localized temporarily-unavailable message and retry control (ru)',
      ctx
    )
  }
}

function webSuite(model, { locale, variant }, ctx) {
  retainWebCatalogue(model, locale, ctx)
  localeDefaults(model, locale, ctx)
  if (variant === 'zod') {
    model.removeNode(testCall(model, REMOVED.zod[0], ctx), { ...ctx, includeLeadingBlank: true })
    removeZodAssertions(model, ctx)
  } else {
    removeTests(model, REMOVED[variant], ctx)
  }
  if (variant === 'api-alert') rewriteNetworkError(model, locale, ctx)
  if (locale === 'ru') rewriteRussian(model, variant, ctx)
}

export function registerLocaleWebSuiteOperations(registry) {
  registry.define('locale.catalogue-fixture', {
    paramsSchema: fixtureParams,
    deriveSemanticWrites: ({ locale, variant }) => [
      claim(`ts:catalogue-fixture:${variant}:locale`, locale),
    ],
    adapter: singleCatalogueFixture,
  })
  registry.define('locale.web-locale-suite', {
    paramsSchema,
    deriveSemanticWrites: ({ locale, variant }) => [
      claim(`ts:web-suite:${variant}:locale`, locale),
      absent(`ts:web-suite:${variant}:cross-locale-case`),
    ],
    adapter: webSuite,
  })
}
