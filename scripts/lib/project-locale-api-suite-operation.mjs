import ts from 'typescript'

import { findUniqueNode } from './path-algebra-ast-query.mjs'
import { attachedJSDoc, callName, claim, localeParams } from './project-locale-ast-helpers.mjs'
import {
  EMAIL_MESSAGES_DOC,
  emailMessagesSuite,
  notificationSuite,
} from './project-locale-api-suite-bodies.mjs'

const suiteParams = (params) =>
  localeParams({ locale: params?.locale }) &&
  Object.keys(params).length === 2 &&
  ['messages', 'notification'].includes(params.variant)

function describeCall(model, title, ctx) {
  return findUniqueNode(
    model,
    (node) =>
      ts.isCallExpression(node) &&
      callName(node) === 'describe' &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === title,
    { ...ctx, describe: `describe block "${title}"` }
  )
}

function apiSuite(model, { locale, variant }, ctx) {
  if (variant === 'notification') {
    const suite = describeCall(model, 'NotificationEmail Template (Integration)', ctx)
    model.replaceNode(suite, notificationSuite(locale), ctx)
    return
  }
  const suite = describeCall(model, 'emailMessages i18n parity', ctx)
  const doc = attachedJSDoc(model, suite.parent, 'i18n parity guard', ctx)
  model.replaceNode(doc, EMAIL_MESSAGES_DOC, ctx)
  model.replaceNode(suite, emailMessagesSuite(locale), ctx)
}

export function registerLocaleApiSuiteOperation(registry) {
  registry.define('locale.api-locale-suite', {
    paramsSchema: suiteParams,
    deriveSemanticWrites: ({ locale, variant }) => [
      claim(`ts:api-suite:${variant}:locale`, locale),
    ],
    adapter: apiSuite,
  })
}
