// Source-state validation for the one-time Operations Console scaffold choice.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import ownedPaths from './admin-console-owned-paths.json' with { type: 'json' }
import { EngineError, readMarkdownField } from './actions.mjs'
import { readCurrentSupportedLocales } from './project-config.mjs'

export const ADMIN_CONSOLE_VALUES = ['disabled', 'path', 'host']
export const DEFAULT_ADMIN_CONSOLE_MODE = 'path'
export const DEFAULT_ADMIN_CONSOLE_SLUG = 'admin'
export const ADMIN_CONSOLE_CONFIG_PATH = 'apps/web/src/shared/lib/admin-console.generated.ts'
export const ADMIN_CONSOLE_ROUTE_ROOT = 'apps/web/src/app/[locale]'

const SLUG_PATTERN = /^[a-z0-9-]{1,63}$/

function routeSegments(dir) {
  const segments = new Set()
  let hasDynamicSegment = false
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (/^\(.*\)$/.test(entry.name) || entry.name.startsWith('@')) {
      const nested = routeSegments(path.join(dir, entry.name))
      nested.segments.forEach((segment) => segments.add(segment))
      hasDynamicSegment ||= nested.hasDynamicSegment
    } else if (entry.name.startsWith('[')) {
      hasDynamicSegment = true
    } else {
      segments.add(entry.name)
    }
  }
  return { segments, hasDynamicSegment }
}

function assertAvailableConsoleRoute(root, slug) {
  const routeRoot = path.join(root, ADMIN_CONSOLE_ROUTE_ROOT)
  const { segments, hasDynamicSegment } = routeSegments(routeRoot)
  if (hasDynamicSegment || (slug !== DEFAULT_ADMIN_CONSOLE_SLUG && segments.has(slug))) {
    throw new EngineError(`--admin-console-slug=${slug} collides with an existing public route`)
  }
}

export function assertAdminConsoleSlug(root, slug) {
  if (!SLUG_PATTERN.test(slug)) {
    throw new EngineError('--admin-console-slug must match ^[a-z0-9-]{1,63}$')
  }
  if (slug === 'api' || readCurrentSupportedLocales(root).includes(slug)) {
    throw new EngineError(`--admin-console-slug=${slug} collides with an existing URL segment`)
  }
  assertAvailableConsoleRoute(root, slug)
}

export function resolveAdminConsolePaths(root, slug = DEFAULT_ADMIN_CONSOLE_SLUG) {
  return {
    config: path.join(root, ADMIN_CONSOLE_CONFIG_PATH),
    route: path.join(root, ADMIN_CONSOLE_ROUTE_ROOT, slug),
    defaultRoute: path.join(root, ADMIN_CONSOLE_ROUTE_ROOT, DEFAULT_ADMIN_CONSOLE_SLUG),
    context: path.join(root, 'PROJECT_CONTEXT.md'),
  }
}

export function assertAdminConsolePristine(root) {
  const paths = resolveAdminConsolePaths(root)
  const ownedPresent = [...ownedPaths.directories, ...ownedPaths.files].every((target) =>
    existsSync(path.join(root, target))
  )
  if (!existsSync(paths.defaultRoute) || !existsSync(paths.config) || !ownedPresent) {
    throw new EngineError(
      'Operations Console is not in the pristine upstream state; this one-time choice cannot run again.'
    )
  }

  const context = readFileSync(paths.context, 'utf8')
  const config = readFileSync(paths.config, 'utf8')
  const fieldsMatch =
    readMarkdownField(context, 'admin_console') === 'enabled' &&
    readMarkdownField(context, 'admin_console_mode') === DEFAULT_ADMIN_CONSOLE_MODE &&
    readMarkdownField(context, 'admin_console_slug') === DEFAULT_ADMIN_CONSOLE_SLUG
  const configMatch =
    /enabled: true,/.test(config) && /mode: 'path',/.test(config) && /slug: 'admin',/.test(config)

  if (!fieldsMatch || !configMatch) {
    throw new EngineError(
      'Operations Console context, generated config, and route presence disagree; resolve the drift by hand.'
    )
  }
}

export function assertAdminConsoleTransition(root, mode, slug) {
  assertAdminConsoleSlug(root, slug)
  assertAdminConsolePristine(root)
  if (mode === DEFAULT_ADMIN_CONSOLE_MODE && slug === DEFAULT_ADMIN_CONSOLE_SLUG) {
    throw new EngineError(
      'Operations Console is already at the upstream default — nothing to apply.'
    )
  }
}
