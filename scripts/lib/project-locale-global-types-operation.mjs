import ts from 'typescript'

import { findUniqueNode } from './path-algebra-ast-query.mjs'
import {
  absent,
  attachedJSDoc,
  claim,
  localeParams,
  uniqueImport,
} from './project-locale-ast-helpers.mjs'

function appConfigProperty(model, name, ctx) {
  return findUniqueNode(
    model,
    (node) => ts.isPropertySignature(node) && ts.isIdentifier(node.name) && node.name.text === name,
    { ...ctx, describe: `AppConfig property "${name}"` }
  )
}

function rewriteContractDoc(model, ctx) {
  const declaration = findUniqueNode(
    model,
    (node) => ts.isModuleDeclaration(node) && node.name.getText() === "'next-intl'",
    { ...ctx, describe: 'next-intl module declaration' }
  )
  const doc = attachedJSDoc(model, declaration, 'Type-level i18n contract.', ctx)
  model.replaceNode(
    doc,
    `/**
 * Type-level i18n contract.
 *
 * Without this, \`t('some.key')\` accepts any string and a typo only surfaces as
 * a missing-message error in the browser. Typing \`Messages\` from the one
 * supported catalogue makes an unknown key a \`pnpm typecheck\` failure instead.
 */`,
    ctx
  )
}

function globalTypes(model, { locale }, ctx) {
  const formats = uniqueImport(model, '@/i18n/request', ctx)
  model.replaceNode(
    formats,
    `import type { DEFAULT_LOCALE } from '@amcore/shared'\n\nimport type { formats } from '@/i18n/request'`,
    ctx
  )
  model.removeNode(uniqueImport(model, '@/i18n/routing', ctx), ctx)
  const messages = uniqueImport(model, '../messages/en.json', ctx)
  if (locale === 'ru') model.replaceNode(messages.moduleSpecifier, `'../messages/ru.json'`, ctx)
  model.replaceNode(appConfigProperty(model, 'Locale', ctx).type, 'typeof DEFAULT_LOCALE', ctx)
  rewriteContractDoc(model, ctx)
}

export function registerLocaleGlobalTypesOperation(registry) {
  registry.define('locale.global-types', {
    paramsSchema: localeParams,
    deriveSemanticWrites: ({ locale }) => [
      absent('ts:import:@/i18n/routing'),
      claim('ts:next-intl:Locale', 'typeof DEFAULT_LOCALE'),
      claim('ts:next-intl:Messages-catalogue', locale),
    ],
    adapter: globalTypes,
  })
}
