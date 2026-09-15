import { operationsConsoleOwnership } from './operations-console-ownership.mjs'
import { filesForFacts } from './ownership-facts.mjs'
import { validateOwnership } from './ownership-validate.mjs'
import {
  assertConsoleOwnershipApplied,
  virtualConsoleSurface,
} from './project-console-residual.mjs'

const content = (path, operationKey, params = {}) => ({
  kind: 'content',
  dimension: 'console',
  path,
  operationKey,
  params,
})
const remove = (path) => ({ kind: 'delete', dimension: 'console', path })
const move = (from, to) => ({ kind: 'move', dimension: 'console', from, to })

function filesFor(inventory, facts) {
  return [...filesForFacts(inventory, facts)].sort()
}

function disabledDeletes(validation) {
  const { inventory, projection } = validation
  const roots = operationsConsoleOwnership.facts.roots.map((fact) => fact.path)
  const standalone = ['topology', 'verification'].flatMap((field) =>
    filesFor(inventory, operationsConsoleOwnership.facts[field])
  )
  return [
    ...roots,
    ...[...projection.deadSharedModules].sort(),
    ...filesFor(inventory, operationsConsoleOwnership.facts.sharedModuleTests).filter((file) =>
      projection.removed.has(file)
    ),
    ...standalone,
  ].map(remove)
}

function seamFacts(disposition, omittedPath) {
  const seen = new Set()
  return operationsConsoleOwnership.seams.flatMap((seam) => {
    if (seam.disposition !== disposition || !seam.operationKey || seam.path === omittedPath)
      return []
    const identity = `${seam.path}\0${seam.operationKey}`
    if (seen.has(identity)) return []
    seen.add(identity)
    return [content(seam.path, seam.operationKey)]
  })
}

function routeMoves(slug) {
  const source = 'apps/web/src/app/[locale]/admin'
  const target = `apps/web/src/app/${slug}`
  const plain = ['layout.tsx', '(protected)/layout.tsx', '(protected)/page.tsx']
  return [
    ...plain.map((relative) => move(`${source}/${relative}`, `${target}/${relative}`)),
    move(`${source}/(auth)/login/page.tsx`, `${target}/(auth)/login/page.tsx`),
    content(`${source}/(auth)/login/page.tsx`, 'console.login-single-locale'),
  ]
}

function proxyPath(proxy) {
  return proxy === 'nginx'
    ? 'docker/nginx/operations-console.conf'
    : 'docker/caddy/Caddyfile.console-host'
}

function proxyFacts(operationKey, slug) {
  return ['nginx', 'caddy'].map((proxy) => content(proxyPath(proxy), operationKey, { slug, proxy }))
}

function enabledFacts(state) {
  const facts = []
  const { selected, adminConsole } = state
  if (selected.adminConsole) {
    facts.push(content('PROJECT_CONTEXT.md', 'context-console', adminConsole))
    facts.push(
      content('apps/web/src/shared/lib/admin-console.generated.ts', 'console.runtime-config', {
        mode: adminConsole.mode,
        slug: adminConsole.slug,
      })
    )
  }
  if (selected.locale) {
    facts.push(...routeMoves(adminConsole.slug))
    if (adminConsole.mode === 'host') {
      facts.push(...proxyFacts('console.proxy-single-locale', adminConsole.slug))
    }
  } else if (selected.adminConsole && adminConsole.slug !== 'admin') {
    facts.push(
      move('apps/web/src/app/[locale]/admin', `apps/web/src/app/[locale]/${adminConsole.slug}`)
    )
    facts.push(...proxyFacts('console.proxy-slug', adminConsole.slug))
  }
  return facts
}

export function buildProjectConsoleFacts(root, state) {
  if (!state.selected.adminConsole && !state.selected.locale) return { facts: [] }
  if (!state.adminConsole.enabled && !state.selected.adminConsole) return { facts: [] }
  const validation = {
    ...validateOwnership(root, operationsConsoleOwnership),
    manifest: operationsConsoleOwnership,
  }
  const omittedMessage = state.selected.locale
    ? `apps/web/messages/${state.locale.base === 'en' ? 'ru' : 'en'}.json`
    : undefined
  const facts = state.adminConsole.enabled
    ? enabledFacts(state)
    : [
        ...disabledDeletes(validation),
        ...seamFacts('remove', omittedMessage),
        ...seamFacts('rewrite'),
      ]
  return {
    facts,
    validation,
    omittedPaths: omittedMessage ? [omittedMessage] : [],
    virtualSurface: virtualConsoleSurface,
  }
}

export { assertConsoleOwnershipApplied }
