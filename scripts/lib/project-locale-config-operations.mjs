import ts from 'typescript'

import { findUniqueNode } from './path-algebra-ast-query.mjs'
import {
  absent,
  claim,
  localeParams,
  objectProperty,
  uniqueImport,
  uniqueVariable,
} from './project-locale-ast-helpers.mjs'

function supportedLocales(model, { locale }, ctx) {
  const supported = uniqueVariable(model, ['SUPPORTED_LOCALES'], ctx)
  const list = findUniqueNode(
    model,
    (node) =>
      ts.isArrayLiteralExpression(node) &&
      (node === supported.initializer || node.parent === supported.initializer),
    { ...ctx, describe: 'SUPPORTED_LOCALES array initializer' }
  )
  model.replaceNode(list, `['${locale}']`, ctx)
  model.replaceNode(uniqueVariable(model, ['DEFAULT_LOCALE'], ctx).initializer, `'${locale}'`, ctx)
}

function messageMap(model, { locale }, ctx) {
  const variable = uniqueVariable(model, ['emailMessages', 'telegramGenericMessages'], ctx)
  const object = findUniqueNode(
    model,
    (node) =>
      ts.isObjectLiteralExpression(node) &&
      (node === variable.initializer || node.parent === variable.initializer),
    { ...ctx, describe: 'locale message-map object' }
  )
  model.removeNode(objectProperty(model, object, locale === 'en' ? 'ru' : 'en', ctx), ctx)
}

export function registerLocaleConfigOperations(registry) {
  registry.define('locale.supported-locales', {
    paramsSchema: localeParams,
    deriveSemanticWrites: ({ locale }) => [
      claim('ts:SUPPORTED_LOCALES', [locale]),
      claim('ts:DEFAULT_LOCALE', locale),
    ],
    adapter: supportedLocales,
  })
  registry.define('locale.message-map', {
    paramsSchema: localeParams,
    deriveSemanticWrites: ({ locale }) => [
      absent(`ts:locale-map:${locale === 'en' ? 'ru' : 'en'}`),
    ],
    adapter: messageMap,
  })
}

export function localeRequestClaims({ locale }) {
  return [
    claim('ts:request-config:catalogue-import', `../../messages/${locale}.json`),
    absent('ts:request-config:dynamic-catalogue-import'),
    claim('ts:request-config:messages-source', 'messages'),
    claim('ts:request-config:runtime-locale', 'DEFAULT_LOCALE'),
  ]
}

export function assertDynamicCatalogueImport(model, ctx) {
  return findUniqueNode(
    model,
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.some((argument) => ts.isTemplateExpression(argument)),
    { ...ctx, describe: 'dynamic message-catalogue import' }
  )
}

export function requestConfig(model, { locale }, ctx) {
  assertDynamicCatalogueImport(model, ctx)
  const hasLocale = uniqueImport(model, 'next-intl', ctx)
  model.replaceNode(
    hasLocale,
    `import { getRequestConfig } from 'next-intl/server'\nimport { DEFAULT_LOCALE } from '@amcore/shared'`,
    ctx
  )
  model.removeNode(uniqueImport(model, 'next-intl/server', ctx), ctx)
  model.replaceNode(
    uniqueImport(model, './routing', ctx),
    `import messages from '../../messages/${locale}.json'`,
    ctx
  )
  const target = findUniqueNode(model, (node) => ts.isExportAssignment(node), {
    ...ctx,
    describe: 'default request config export',
  })
  model.replaceNode(
    target,
    `// Single-locale mode has no route locale to resolve at runtime.
export default getRequestConfig(async () => ({
  locale: DEFAULT_LOCALE,
  formats,
  messages,
}))`,
    ctx
  )
}
