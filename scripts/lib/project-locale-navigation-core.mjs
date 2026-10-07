import ts from 'typescript'

import { findAllNodes, findUniqueNode } from './path-algebra-ast-query.mjs'
import {
  callName,
  attachedJSDoc,
  objectProperty,
  uniqueFunction,
  uniqueImport,
} from './project-locale-ast-helpers.mjs'

export function dropLocalePushOption(model, ctx) {
  const callback = findUniqueNode(
    model,
    (node) =>
      ts.isPropertyAssignment(node) &&
      node.name.getText() === 'onSuccess' &&
      ts.isArrowFunction(node.initializer),
    { ...ctx, describe: 'onSuccess navigation callback' }
  )
  const push = findUniqueNode(
    model,
    (node) => ts.isCallExpression(node) && node.expression.getText() === 'router.push',
    { ...ctx, describe: 'ordinary authentication locale navigation' },
    callback
  )
  if (
    push.arguments.length !== 2 ||
    push.arguments[0].getText() !== "'/'" ||
    !ts.isObjectLiteralExpression(push.arguments[1])
  )
    throw new Error('authentication locale push contract drifted')
  const locale = objectProperty(model, push.arguments[1], 'locale', ctx)
  if (
    locale.initializer.getText() !== 'response.user.locale' ||
    push.arguments[1].properties.length !== 1
  )
    throw new Error('authentication locale option contract drifted')
  model.removeNode(push.arguments[1], ctx)
}

export function rewriteDal(model, ctx) {
  model.removeNode(uniqueImport(model, 'next-intl', ctx), ctx)
  model.removeNode(uniqueImport(model, 'next-intl/server', ctx), ctx)
  const user = uniqueImport(model, '@amcore/shared', ctx)
  model.replaceNode(user, `import { redirect } from 'next/navigation'\n${user.getText()}`, ctx)
  model.removeNode(uniqueImport(model, '@/i18n/navigation', ctx), ctx)
  const redirects = findAllNodes(
    model,
    (node) => ts.isCallExpression(node) && callName(node) === 'redirect'
  ).filter((call) => call.arguments.length === 1 && ts.isObjectLiteralExpression(call.arguments[0]))
  if (redirects.length !== 2)
    throw new Error(`expected two locale-aware redirects, found ${redirects.length}`)
  for (const call of redirects) {
    const href = objectProperty(model, call.arguments[0], 'href', ctx).initializer
    model.replaceNode(call.arguments[0], href.getText(), ctx)
  }
  const fn = uniqueFunction(model, 'redirectIfAuthenticated', ctx)
  if (fn.parameters.length !== 1)
    throw new Error('redirectIfAuthenticated locale parameter drifted')
  model.replaceNode(fn.parameters[0], '', ctx)
}

function localeParameter(model, name, ctx) {
  const fn = uniqueFunction(model, name, ctx)
  return findUniqueNode(
    model,
    (node) => ts.isParameter(node) && node.parent === fn && node.name.getText() === 'locale',
    { ...ctx, describe: `${name} locale parameter` },
    fn
  )
}

export function rewriteOAuth(model, ctx) {
  model.removeNode(localeParameter(model, 'handleOAuthExchange', ctx), ctx)
  model.removeNode(localeParameter(model, 'failureRedirect', ctx), ctx)
  const calls = findAllNodes(
    model,
    (node) => ts.isCallExpression(node) && callName(node) === 'failureRedirect'
  )
  for (const call of calls) {
    const locale = call.arguments.find((argument) => argument.getText() === 'locale')
    if (locale) model.removeNode(locale, ctx)
  }
  const urls = findAllNodes(
    model,
    (node) =>
      ts.isNewExpression(node) &&
      node.expression.getText() === 'URL' &&
      ts.isTemplateExpression(node.arguments?.[0])
  )
  if (urls.length !== 2) throw new Error(`expected two locale URL templates, found ${urls.length}`)
  model.replaceNode(urls[0].arguments[0], `'/'`, ctx)
  model.replaceNode(urls[1].arguments[0], `'/login'`, ctx)
  const doc = attachedJSDoc(
    model,
    uniqueFunction(model, 'handleOAuthExchange', ctx),
    '/{locale}/auth/callback',
    ctx
  )
  model.replaceNode(doc, doc.getText().replace('/{locale}/auth/callback', '/auth/callback'), ctx)
}
