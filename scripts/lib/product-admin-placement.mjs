import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import {
  RESERVED_ROOT_SEGMENTS,
  aliasProblems,
  readAdminConsoleSettings,
  readLocaleSettings,
} from './settings-files.mjs'

const configPath = 'packages/shared/src/config/product-admin.json'
const terminal = /^(?:page|route)\.[cm]?[jt]sx?$/
const metadata =
  /^(?:robots|sitemap|manifest|icon|apple-icon|opengraph-image|twitter-image|favicon)(?:\.|$)/
const group = /^\([^)]*\)$/

function assets(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${prefix}/${entry.name}`
    return entry.isDirectory() ? assets(join(directory, entry.name), path) : [path]
  })
}

export function readProductAdminPlacement(root) {
  const config = JSON.parse(readFileSync(join(root, configPath), 'utf8'))
  if (
    Object.keys(config).sort().join(',') !== 'alias,mode,version' ||
    config.version !== 1 ||
    !['path', 'host'].includes(config.mode) ||
    !/^[a-z][a-z0-9_-]{0,31}$/.test(config.alias)
  )
    throw new Error('Invalid product-admin source config')
  return config
}

/** Inspect actual endpoints; routing groups do not occupy public segments. */
function inventory(directory, segments = [], result = []) {
  if (!existsSync(directory)) return result
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (item.name.startsWith('_') || item.name.startsWith('.')) continue
    const path = join(directory, item.name)
    if (item.isDirectory()) {
      const next =
        group.test(item.name) || item.name.startsWith('@') ? segments : [...segments, item.name]
      inventory(path, next, result)
    } else if (terminal.test(item.name)) result.push({ path, segments })
    else if (metadata.test(item.name))
      result.push({ path, segments: [...segments, item.name.split('.')[0]] })
  }
  return result
}

function collides(segment, alias) {
  return segment === alias || segment?.startsWith('[') || segment?.startsWith('(')
}

export function inspectProductAdminPlacement(root, candidateAlias) {
  const config = readProductAdminPlacement(root)
  const alias = candidateAlias ?? config.alias
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(alias)) throw new Error('Invalid product-admin alias')
  const app = join(root, 'apps/web/src/app')
  // The physical `[locale]` folder is always present. Public paths carry a locale prefix only
  // when the build serves more than one locale (one locale is rewritten onto the folder).
  const routeRoot = join(app, '[locale]')
  if (!existsSync(routeRoot)) throw new Error('Missing physical [locale] route folder')
  // Validated with the shared schema's rules: a wrong locales file stops here, not later.
  const { enabled: locales, default: defaultLocale } = readLocaleSettings(root)
  const localized = locales.length > 1
  const ownedGroup = join(routeRoot, '(product-admin)')
  const physicalRoot = join(ownedGroup, config.alias)
  if (!existsSync(physicalRoot))
    throw new Error('Product-admin config and physical route root disagree')
  const children = readdirSync(ownedGroup, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory()
  )
  if (children.length !== 1 || children[0].name !== config.alias)
    throw new Error('Product-admin physical route group must contain exactly its configured alias')
  const owned = inventory(physicalRoot)
  const routes = inventory(app)
  for (const endpoint of routes) {
    if (endpoint.path.startsWith(`${physicalRoot}/`)) continue
    const segments =
      endpoint.segments[0] === '[locale]' ? endpoint.segments.slice(1) : endpoint.segments
    if (collides(segments[0], alias))
      throw new Error(`Product-admin alias collides with ${relative(root, endpoint.path)}`)
  }
  for (const entry of readdirSync(join(root, 'apps/web/public'), { withFileTypes: true }))
    if (entry.name === alias || entry.name.split('.')[0] === alias)
      throw new Error(`Product-admin alias collides with public asset ${entry.name}`)
  // Reserved roots include every catalogue locale, served or not: a locale you stop serving can
  // come back, and its first path segment must stay free.
  if (RESERVED_ROOT_SEGMENTS.includes(alias))
    throw new Error('Product-admin alias collides with a reserved root')
  inspectConsoleAlias(root, app, alias)
  for (const required of ['/login', '/organizations', '/settings/api-keys', '/settings/sessions'])
    if (!owned.some((entry) => `/${entry.segments.join('/')}` === required))
      throw new Error(`Missing product-admin physical page ${required}`)
  return {
    ...config,
    alias,
    localized,
    locales,
    defaultLocale,
    physicalRoot,
    assets: assets(join(root, 'apps/web/public')),
    routes: owned.map((entry) => entry.segments),
  }
}

/**
 * The Console alias is the name of the physical folder `[locale]/<alias>` and, in path mode, its public
 * segment. It must be a free first segment: not the product-admin alias, not another route or public
 * asset, and not a reserved root or catalogue locale. Checked in every mode, including `disabled`,
 * because the folder stays in the build.
 */
function inspectConsoleAlias(root, app, productAlias) {
  const { alias } = readAdminConsoleSettings(root)
  if (aliasProblems(alias).length > 0) throw new Error('Console alias is invalid or reserved')
  if (alias === productAlias) throw new Error('Console alias equals the product-admin alias')
  const folder = join(app, '[locale]', alias)
  if (!existsSync(folder)) throw new Error('Console alias disagrees with its physical routes')
  for (const endpoint of inventory(app)) {
    if (endpoint.path.startsWith(`${folder}/`)) continue
    const segments =
      endpoint.segments[0] === '[locale]' ? endpoint.segments.slice(1) : endpoint.segments
    if (collides(segments[0], alias))
      throw new Error(`Console alias collides with ${relative(root, endpoint.path)}`)
  }
  for (const entry of readdirSync(join(root, 'apps/web/public'), { withFileTypes: true }))
    if (entry.name === alias || entry.name.split('.')[0] === alias)
      throw new Error(`Console alias collides with public asset ${entry.name}`)
}
