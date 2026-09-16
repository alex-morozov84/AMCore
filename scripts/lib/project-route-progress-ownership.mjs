import { defineOwnershipManifest } from './ownership-manifest.mjs'

export const ROUTE_PROGRESS_SOURCE_PATH =
  'apps/web/src/shared/lib/route-progress/route-progress-flag.ts'
export const ROUTE_PROGRESS_OPERATION_KEY = 'route-progress.set-source-default'

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

export const routeProgressOwnership = defineOwnershipManifest({
  feature: 'route-progress-source-default',
  tags: { topology: ['enabled', 'disabled'], verification: ['test', 'build'] },
  surfaceRoots: [ROUTE_PROGRESS_SOURCE_PATH],
  tsconfigs: ['apps/web/tsconfig.json'],
  testGlobs: [],
  monitoredIdentifiers: ['ROUTE_PROGRESS_ENABLED'],
  facts: emptyFacts,
  seams: [
    {
      id: 'route-progress.source-default',
      path: ROUTE_PROGRESS_SOURCE_PATH,
      kind: 'file',
      cardinality: 'one',
      seamKind: 'structural-operation',
      selector: { identifiers: ['ROUTE_PROGRESS_ENABLED'] },
      detectors: ['ROUTE_PROGRESS_ENABLED'],
      disposition: 'rewrite',
      operationKey: ROUTE_PROGRESS_OPERATION_KEY,
    },
  ],
})
