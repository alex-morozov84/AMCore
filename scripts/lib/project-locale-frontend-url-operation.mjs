import ts from 'typescript'

import { findAllNodes, findUniqueNode } from './path-algebra-ast-query.mjs'
import { callName, claim, localeParams, testCall } from './project-locale-ast-helpers.mjs'

function suite(model, title, ctx) {
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

function expressionStatements(model, root) {
  return findAllNodes(model, (node) => ts.isExpressionStatement(node), root)
}

function inside(node, ancestor) {
  return ancestor && ancestor.getStart() <= node.getStart() && node.end <= ancestor.end
}

function projectLocalizedUrls(model, root, ctx, skipped) {
  const calls = findAllNodes(
    model,
    (node) => ts.isCallExpression(node) && node.expression.getText() === 'localizedFrontendUrl',
    root
  )
  for (const call of calls.filter((node) => !inside(node, skipped) && !model.isRemoved(node))) {
    if (ts.isStringLiteral(call.arguments[1]))
      model.replaceNode(call.arguments[1], 'DEFAULT_LOCALE', ctx)
  }
  const urls = findAllNodes(
    model,
    (node) =>
      ts.isStringLiteral(node) && /^https:\/\/app\.example\.com\/(?:en|ru)(?:\/|$)/.test(node.text),
    root
  )
  for (const url of urls.filter((node) => !inside(node, skipped) && !model.isRemoved(node))) {
    model.replaceNode(url, `'${url.text.replace(/\/(?:en|ru)(?=\/|$)/, '')}'`, ctx)
  }
}

function localizedUrlSuite(model, ctx) {
  const root = suite(model, 'localizedFrontendUrl', ctx)
  const first = testCall(model, 'prefixes the locale, including the default one', ctx)
  model.replaceNode(first.arguments[0], "'builds a bare path with no locale prefix'", ctx)
  const statements = expressionStatements(model, first).filter((node) =>
    node.getText().includes('localizedFrontendUrl')
  )
  if (statements.length !== 2)
    throw new Error(`${ctx.operationKey}: expected two prefix assertions`)
  model.replaceNode(
    statements[0],
    `// Single-locale routes omit the locale segment entirely.\n    ${statements[0]
      .getText()
      .replace('/en/verify-email', '/verify-email')}`,
    { ...ctx, includeLeadingComments: true }
  )
  model.removeNode(statements[1], ctx)
  for (const [before, after] of [
    [
      'returns the locale root when no path is given',
      'returns the bare base URL when no path is given',
    ],
  ]) {
    model.replaceNode(testCall(model, before, ctx).arguments[0], `'${after}'`, ctx)
  }
  projectLocalizedUrls(model, root, ctx, statements[0])
}

function prefixSuite(model, locale, ctx) {
  suite(model, 'localePathPrefix', ctx)
  const multi = testCall(model, 'prefixes the locale when more than one is supported', ctx)
  const assertions = expressionStatements(model, multi)
  if (assertions.length !== 2) throw new Error(`${ctx.operationKey}: expected two prefix branches`)
  const selected = assertions.find((node) => {
    const call = findAllNodes(
      model,
      (child) => ts.isCallExpression(child) && child.expression.getText() === 'localePathPrefix',
      node
    )[0]
    return call?.arguments[0]?.getText() === `'${locale}'`
  })
  const other = assertions.find((node) => node !== selected)
  if (!selected || !other) throw new Error(`${ctx.operationKey}: selected prefix branch is missing`)
  model.removeNode(other, ctx)

  const single = testCall(
    model,
    'omits the prefix once exactly one locale is supported (pnpm init:project --mode=single)',
    ctx
  )
  const singleStrings = findAllNodes(model, (node) => ts.isStringLiteral(node), single)
  for (const node of singleStrings.filter((node) => node.text === 'en')) {
    if (locale === 'ru') model.replaceNode(node, "'ru'", ctx)
  }

  const defaults = testCall(
    model,
    'defaults to the real SUPPORTED_LOCALES, which is multi-locale on AMCore upstream today',
    ctx
  )
  model.replaceNode(
    defaults.arguments[0],
    "'defaults to the real SUPPORTED_LOCALES, which is single-locale after init:project --mode=single'",
    ctx
  )
  const call = findUniqueNode(
    model,
    (node) => ts.isCallExpression(node) && node.expression.getText() === 'localePathPrefix',
    { ...ctx, describe: 'default localePathPrefix call' },
    defaults
  )
  model.replaceNode(call.arguments[0], 'DEFAULT_LOCALE', ctx)
  const expected = findUniqueNode(
    model,
    (node) => ts.isStringLiteral(node) && node.text === '/en',
    { ...ctx, describe: 'upstream default prefix expectation' },
    defaults
  )
  model.replaceNode(expected, "''", ctx)
}

function frontendUrl(model, { locale }, ctx) {
  localizedUrlSuite(model, ctx)
  prefixSuite(model, locale, ctx)
}

export function registerLocaleFrontendUrlOperation(registry) {
  registry.define('locale.frontend-url-test', {
    paramsSchema: localeParams,
    deriveSemanticWrites: ({ locale }) => [
      claim('ts:frontend-url-test:topology', 'unprefixed'),
      claim('ts:frontend-url-test:typed-locale', locale),
      claim('ts:frontend-url-test:multi-prefix', `/${locale}`),
    ],
    adapter: frontendUrl,
  })
}
