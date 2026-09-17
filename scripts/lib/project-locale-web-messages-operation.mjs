import { findUniqueNode, isVariableStatementNamed } from './path-algebra-ast-query.mjs'
import {
  absent,
  attachedJSDoc,
  claim,
  localeParams,
  uniqueFunction,
  uniqueImport,
} from './project-locale-ast-helpers.mjs'
import { rewriteMessageSuite } from './project-locale-web-messages-suite.mjs'

const CATEGORIES = {
  en: "['one', 'other']",
  ru: "['one', 'few', 'many', 'other']",
}

function webMessages(model, { locale }, ctx) {
  const en = uniqueImport(model, '../../messages/en.json', ctx)
  const ru = uniqueImport(model, '../../messages/ru.json', ctx)
  const selected = locale === 'en' ? en : ru
  model.replaceNode(selected.importClause.name, 'catalogue', ctx)
  model.removeNode(locale === 'en' ? ru : en, ctx)
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
  const doc = attachedJSDoc(model, plural, 'CLDR plural categories', ctx)
  const nextDoc = doc
    .getText()
    .replace('that each locale must supply', 'the supported locale must supply')
    .replace(/ Russian needs[\s\S]*?checklist item\./, '')
  model.replaceNode(doc, nextDoc, ctx)
  const declaration = plural.declarationList.declarations[0]
  model.replaceNode(declaration.initializer, CATEGORIES[locale], ctx)
  model.replaceNode(declaration.type, 'string[]', ctx)
  rewriteMessageSuite(model, locale, ctx)
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
