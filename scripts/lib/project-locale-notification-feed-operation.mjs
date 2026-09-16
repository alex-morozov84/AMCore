import ts from 'typescript'

import { findUniqueNode } from './path-algebra-ast-query.mjs'
import { callName, claim, localeParams, testCall } from './project-locale-ast-helpers.mjs'

const TITLE = 'renders items in the recipient locale and reports no more when within limit'

function beforeEachCall(model, ctx) {
  return findUniqueNode(
    model,
    (node) => ts.isCallExpression(node) && callName(node) === 'beforeEach',
    { ...ctx, describe: 'notification feed beforeEach block' }
  )
}

function stringProperty(model, root, name, values, ctx) {
  return findUniqueNode(
    model,
    (node) =>
      ts.isPropertyAssignment(node) &&
      node.name.getText() === name &&
      ts.isStringLiteral(node.initializer) &&
      values.includes(node.initializer.text),
    { ...ctx, describe: `${name} fixture property` },
    root
  )
}

function notificationFeed(model, { locale }, ctx) {
  const setup = beforeEachCall(model, ctx)
  const recipient = stringProperty(model, setup, 'locale', ['en', 'ru'], ctx)
  const target = testCall(model, TITLE, ctx)
  const title = stringProperty(model, target, 'title', ['Profile updated', 'Профиль обновлён'], ctx)
  if (locale === 'en') return
  model.replaceNode(recipient.initializer, `'ru'`, ctx)
  model.replaceNode(title.initializer, "'Профиль обновлён'", ctx)
}

export function registerLocaleNotificationFeedOperation(registry) {
  registry.define('locale.notification-feed-test', {
    paramsSchema: localeParams,
    deriveSemanticWrites: ({ locale }) => [
      claim('ts:notification-feed-test:recipient-locale', locale),
      claim(
        'ts:notification-feed-test:profile-title',
        locale === 'en' ? 'Profile updated' : 'Профиль обновлён'
      ),
    ],
    adapter: notificationFeed,
  })
}
