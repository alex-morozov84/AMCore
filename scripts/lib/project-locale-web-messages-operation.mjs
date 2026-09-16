import ts from 'typescript'

import { findUniqueNode, isVariableStatementNamed } from './path-algebra-ast-query.mjs'
import {
  absent,
  attachedJSDoc,
  callName,
  claim,
  localeParams,
  uniqueFunction,
  uniqueImport,
} from './project-locale-ast-helpers.mjs'
import {
  WEB_MESSAGES_DOC,
  webMessagesSuite,
  webPluralCategories,
} from './project-locale-web-messages-body.mjs'

function describeCall(model, ctx) {
  return findUniqueNode(
    model,
    (node) =>
      ts.isCallExpression(node) &&
      callName(node) === 'describe' &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'message catalogues',
    { ...ctx, describe: 'message catalogues describe block' }
  )
}

function webMessages(model, { locale }, ctx) {
  const en = uniqueImport(model, '../../messages/en.json', ctx)
  const ru = uniqueImport(model, '../../messages/ru.json', ctx)
  model.replaceNode(en, `import catalogue from '../../messages/${locale}.json'`, ctx)
  model.removeNode(ru, ctx)
  model.removeNode(uniqueImport(model, './routing', ctx), ctx)
  model.removeNode(
    findUniqueNode(model, (node) => isVariableStatementNamed(node, 'catalogues'), {
      ...ctx,
      describe: 'catalogues declaration',
    }),
    ctx
  )
  model.removeNode(uniqueFunction(model, 'leafPaths', ctx), ctx)
  const plural = findUniqueNode(
    model,
    (node) => isVariableStatementNamed(node, 'REQUIRED_PLURAL_CATEGORIES'),
    { ...ctx, describe: 'plural categories declaration' }
  )
  model.replaceNode(
    attachedJSDoc(model, plural, 'CLDR plural categories', ctx),
    WEB_MESSAGES_DOC,
    ctx
  )
  const declaration = plural.declarationList.declarations[0]
  model.replaceNode(declaration, `REQUIRED_PLURAL_CATEGORIES = ${webPluralCategories(locale)}`, ctx)
  model.replaceNode(describeCall(model, ctx), webMessagesSuite(locale), ctx)
}

export function registerLocaleWebMessagesOperation(registry) {
  registry.define('locale.web-messages-test', {
    paramsSchema: localeParams,
    deriveSemanticWrites: ({ locale }) => [
      claim('ts:web-messages:catalogue', locale),
      absent('ts:web-messages:cross-locale-parity'),
    ],
    adapter: webMessages,
  })
}
