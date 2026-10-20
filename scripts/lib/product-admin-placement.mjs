import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

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
  const localized = existsSync(join(app, '[locale]'))
  const routeRoot = localized ? join(app, '[locale]') : app
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
  const constants = readFileSync(join(root, 'packages/shared/src/constants/index.ts'), 'utf8')
  const literal = constants.match(/export const SUPPORTED_LOCALES\s*=\s*\[([^\]]*)\]/)?.[1]
  if (!literal || !/^\s*'[-a-zA-Z0-9]+'(?:\s*,\s*'[-a-zA-Z0-9]+')*\s*,?\s*$/.test(literal))
    throw new Error('Placement requires the declared literal SUPPORTED_LOCALES source')
  const locales = [...literal.matchAll(/'([-a-zA-Z0-9]+)'/g)].map((match) => match[1])
  const defaultLocale = constants.match(
    /export const DEFAULT_LOCALE[^=]*=\s*'([-a-zA-Z0-9]+)'/
  )?.[1]
  if (!locales.includes(defaultLocale)) throw new Error('Missing declared default locale')
  if (['_next', 'api', ...locales].includes(alias))
    throw new Error('Product-admin alias collides with a reserved root')
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
