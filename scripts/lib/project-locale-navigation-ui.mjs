import ts from 'typescript'

import { findUniqueNode, isVariableStatementNamed } from './path-algebra-ast-query.mjs'
import { attachedJSDoc, uniqueFunction, uniqueImport } from './project-locale-ast-helpers.mjs'

function names(node) {
  return node.importClause?.namedBindings?.elements?.map((item) => item.name.text) ?? []
}

function rewriteRouter(model, localeImport, ctx) {
  const react = uniqueImport(model, 'react', ctx)
  model.replaceNode(react, `${react.getText()}\nimport { useRouter } from 'next/navigation'`, ctx)
  model.removeNode(localeImport, ctx)
  const doc = attachedJSDoc(
    model,
    uniqueFunction(model, 'useRouteProgressRouter', ctx),
    '@/i18n/navigation',
    ctx
  )
  model.replaceNode(doc, doc.getText().replaceAll('@/i18n/navigation', 'next/navigation'), ctx)
}

function retainedRawKey(rawKey) {
  return `// Separate from \`lastKeyRef\` for structural symmetry with the multi-locale
  // version of this file: there, the locale-aware \`usePathname()\` hook is
  // locale-*stripped* while \`handlePopState\` below only has the locale-
  // *prefixed* \`window.location.pathname\`, and comparing those two formats
  // directly caused a real regression (see \`route-progress-bar.test.tsx\`).
  // Single-locale mode has no \`[locale]\` segment, so \`usePathname()\` here
  // (\`next/navigation\`'s own) and \`window.location.pathname\` always agree
  // already -- this ref costs nothing to keep and avoids diverging the two
  // variants' logic over a distinction that no longer exists.
  ${rawKey.getText()}`
}

export function rewriteNavigationAdapter(model, ctx) {
  const localeImport = uniqueImport(model, '@/i18n/navigation', ctx)
  const imported = names(localeImport)
  if (imported.includes('useRouter')) return rewriteRouter(model, localeImport, ctx)
  const next = uniqueImport(model, 'next/navigation', ctx)
  if (imported.includes('Link')) {
    model.replaceNode(
      next,
      `import Link from 'next/link'\nimport { usePathname, useSearchParams } from 'next/navigation'`,
      ctx
    )
    model.removeNode(localeImport, ctx)
    return
  }
  model.replaceNode(next, `import { usePathname, useSearchParams } from 'next/navigation'`, ctx)
  model.removeNode(localeImport, ctx)
  const rawKey = findUniqueNode(model, (node) => isVariableStatementNamed(node, 'lastRawKeyRef'), {
    ...ctx,
    describe: 'lastRawKeyRef declaration',
  })
  model.replaceNode(rawKey, retainedRawKey(rawKey), { ...ctx, includeLeadingComments: true })
}

export function removeLocaleSwitcher(model, ctx) {
  model.removeNode(uniqueImport(model, '@/features/locale-switcher', ctx), ctx)
  const wrapper = findUniqueNode(
    model,
    (node) =>
      ts.isJsxElement(node) &&
      node.children.some(
        (child) => ts.isJsxSelfClosingElement(child) && child.tagName.getText() === 'LocaleSwitcher'
      ),
    { ...ctx, describe: 'AppShell footer wrapper containing LocaleSwitcher' }
  )
  model.replaceNode(
    wrapper,
    `<div className="flex items-center justify-between gap-2 px-2">
            <LogoutButton variant="ghost" showText={false} />
          </div>`,
    ctx
  )
}
