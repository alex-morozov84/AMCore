import ts from 'typescript'
import { findAllNodes, findUniqueNode } from './path-algebra-ast-query.mjs'
import {
  absent,
  claim,
  defaultFunction,
  localeParams,
  uniqueFunction,
  uniqueImport,
} from './project-locale-ast-helpers.mjs'

function rewriteImports(model, ctx) {
  model.replaceNode(
    uniqueImport(model, 'next-intl/server', ctx),
    `import { getTranslations } from 'next-intl/server'\nimport { DEFAULT_LOCALE } from '@amcore/shared'`,
    ctx
  )
  model.removeNode(uniqueImport(model, '@/i18n/params', ctx), ctx)
  model.removeNode(uniqueImport(model, '@/i18n/routing', ctx), ctx)
  const css = uniqueImport(model, '../globals.css', ctx)
  model.replaceNode(css.moduleSpecifier, `'./globals.css'`, ctx)
}

function removeLocaleDeclarations(model, ctx) {
  const alias = findUniqueNode(
    model,
    (node) => ts.isTypeAliasDeclaration(node) && node.name.text === 'LocaleParams',
    { ...ctx, describe: 'LocaleParams type alias' }
  )
  model.removeNode(alias, ctx)
  model.removeNode(uniqueFunction(model, 'generateStaticParams', ctx), ctx)
}

function removeLocaleParameter(model, fn, ctx) {
  const binding = findUniqueNode(
    model,
    (node) => ts.isBindingElement(node) && node.name.getText() === 'params',
    { ...ctx, describe: 'params binding' },
    fn
  )
  model.removeNode(binding, ctx)
  const property = findUniqueNode(
    model,
    (node) => ts.isPropertySignature(node) && node.name.getText() === 'params',
    { ...ctx, describe: 'params type property' },
    fn
  )
  model.removeNode(property, ctx)
}

function removeLocaleSetup(model, fn, ctx) {
  const locale = findUniqueNode(
    model,
    (node) =>
      ts.isVariableDeclaration(node) &&
      node.name.getText() === 'locale' &&
      node.initializer?.getText() === 'await resolveLocaleParam(params)',
    { ...ctx, describe: 'resolved locale declaration' },
    fn
  )
  model.removeNode(locale.parent.parent, ctx)
  const setup = findUniqueNode(
    model,
    (node) =>
      ts.isExpressionStatement(node) && node.expression.getText() === 'setRequestLocale(locale)',
    { ...ctx, describe: 'setRequestLocale(locale) statement' },
    fn
  )
  model.removeNode(setup, ctx)
}

function rewriteMetadata(model, ctx) {
  const fn = uniqueFunction(model, 'generateMetadata', ctx)
  model.replaceNode(fn.parameters[0], '', ctx)
  const locale = findUniqueNode(
    model,
    (node) => ts.isVariableDeclaration(node) && node.name.getText() === 'locale',
    { ...ctx, describe: 'metadata locale declaration' },
    fn
  )
  model.removeNode(locale.parent.parent, ctx)
  const shorthand = findUniqueNode(
    model,
    (node) => ts.isShorthandPropertyAssignment(node) && node.name.text === 'locale',
    { ...ctx, describe: 'getTranslations locale property' },
    fn
  )
  model.replaceNode(shorthand, 'locale: DEFAULT_LOCALE', ctx)
}

function rewriteLayout(model, ctx) {
  const fn = defaultFunction(model, ctx)
  model.replaceNode(fn.name, 'RootLayout', ctx)
  removeLocaleParameter(model, fn, ctx)
  removeLocaleSetup(model, fn, ctx)
  const nonce = findUniqueNode(
    model,
    (node) => ts.isVariableStatement(node) && node.getText().includes('NONCE_REQUEST_HEADER'),
    { ...ctx, describe: 'layout nonce declaration' },
    fn
  )
  const comments = ts.getLeadingCommentRanges(model.text, nonce.getFullStart()) ?? []
  const nonceWithComments = model.text.slice(comments[0]?.pos ?? nonce.getStart(), nonce.end)
  const projectedComment = nonceWithComments.replace(
    'every locale route, including the two previously-SSG\n  // auth-link pages',
    'every single-locale route'
  )
  if (projectedComment === nonceWithComments) {
    throw new Error(`${ctx.operationKey}: layout route-topology comment drifted`)
  }
  model.replaceNode(nonce, projectedComment, { ...ctx, includeLeadingComments: true })
  const lang = findUniqueNode(
    model,
    (node) => ts.isJsxAttribute(node) && node.name.getText() === 'lang',
    { ...ctx, describe: 'html lang attribute' },
    fn
  )
  model.replaceNode(lang.initializer.expression, 'DEFAULT_LOCALE', ctx)
  const localeReferences = findAllNodes(
    model,
    (node) => ts.isIdentifier(node) && node.text === 'locale',
    fn
  ).filter((node) => node !== lang.initializer.expression && !model.isRemoved(node))
  if (localeReferences.length !== 0) {
    throw new Error(`${ctx.operationKey}: unexpected surviving layout locale reference`)
  }
}

function rootLayout(model, _params, ctx) {
  rewriteImports(model, ctx)
  removeLocaleDeclarations(model, ctx)
  rewriteMetadata(model, ctx)
  rewriteLayout(model, ctx)
}

export function registerLocaleRootLayoutOperation(registry) {
  registry.define('locale.root-layout', {
    paramsSchema: localeParams,
    deriveSemanticWrites: () => [
      absent('ts:root-layout:LocaleParams'),
      absent('ts:root-layout:generateStaticParams'),
      claim('ts:root-layout:metadata-locale', 'DEFAULT_LOCALE'),
      claim('ts:root-layout:html-language', 'DEFAULT_LOCALE'),
    ],
    adapter: rootLayout,
  })
}
