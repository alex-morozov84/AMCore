import { defineOwnershipManifest } from './ownership-manifest.mjs'

export const BRAND_PATHS = Object.freeze({
  context: 'PROJECT_CONTEXT.md',
  package: 'package.json',
  manifest: 'apps/web/src/app/manifest.ts',
  enMessages: 'apps/web/messages/en.json',
  ruMessages: 'apps/web/messages/ru.json',
  theme: 'apps/web/src/shared/lib/theme.ts',
  logoDark: 'apps/web/public/logo-dark.png',
  logoLight: 'apps/web/public/logo-light.png',
  icon192: 'apps/web/public/icons/icon-192x192.png',
  icon512: 'apps/web/public/icons/icon-512x512.png',
  icon512Maskable: 'apps/web/public/icons/icon-512x512-maskable.png',
})

export const BRAND_ASSET_PATHS = Object.freeze([
  BRAND_PATHS.logoDark,
  BRAND_PATHS.logoLight,
  BRAND_PATHS.icon192,
  BRAND_PATHS.icon512,
  BRAND_PATHS.icon512Maskable,
])

const fieldSeam = (id, path, selector, operationKey, occurrences) => ({
  id,
  path,
  kind: 'file',
  cardinality: 'one',
  seamKind: operationKey ? 'structural-operation' : 'config-field',
  selector,
  detectors: [id],
  disposition: 'rewrite',
  ...(operationKey ? { operationKey } : {}),
  ...(occurrences ? { occurrences } : {}),
})

export const BRAND_SEAMS = Object.freeze([
  fieldSeam('brand.context.identity', BRAND_PATHS.context, { text: '## Identity' }),
  fieldSeam('brand.package.name', BRAND_PATHS.package, { jsonPath: ['name'] }),
  fieldSeam('brand.package.description', BRAND_PATHS.package, { jsonPath: ['description'] }),
  fieldSeam(
    'brand.manifest.fields',
    BRAND_PATHS.manifest,
    { identifiers: ['short_name:', 'description:', "\n    name: '"] },
    'brand.set-manifest-fields',
    3
  ),
  fieldSeam('brand.messages.en.meta', BRAND_PATHS.enMessages, { jsonPath: ['meta'] }),
  fieldSeam('brand.messages.ru.title', BRAND_PATHS.ruMessages, { jsonPath: ['meta', 'title'] }),
  fieldSeam(
    'brand.theme.default',
    BRAND_PATHS.theme,
    { text: 'export const DEFAULT_THEME_SETTING:' },
    'brand.set-theme-default'
  ),
])

const emptyFacts = {
  roots: [],
  featureFiles: [],
  sharedModules: [],
  sharedModuleTests: [],
  topology: [],
  verification: [],
  documentation: [],
  featureEntrypoints: [],
  repositoryEntrypoints: [],
}

export function brandOwnershipFor(paths) {
  const selected = new Set(paths)
  const seams = BRAND_SEAMS.filter((seam) => selected.has(seam.path))
  return defineOwnershipManifest({
    feature: 'brand-identity',
    tags: { topology: [], verification: ['test'] },
    surfaceRoots: [...selected],
    tsconfigs: [],
    testGlobs: [],
    monitoredIdentifiers: [],
    facts: emptyFacts,
    seams,
  })
}
