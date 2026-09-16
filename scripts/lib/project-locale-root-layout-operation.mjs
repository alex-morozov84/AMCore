import ts from 'typescript'

import { findUniqueNode } from './path-algebra-ast-query.mjs'
import { ROOT_LAYOUT_BODY, ROOT_METADATA_BODY } from './project-locale-root-layout-body.mjs'
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

function rootLayout(model, _params, ctx) {
  rewriteImports(model, ctx)
  removeLocaleDeclarations(model, ctx)
  model.replaceNode(uniqueFunction(model, 'generateMetadata', ctx), ROOT_METADATA_BODY, ctx)
  model.replaceNode(defaultFunction(model, ctx), ROOT_LAYOUT_BODY, ctx)
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
