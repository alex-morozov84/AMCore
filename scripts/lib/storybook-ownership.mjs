import { defineOwnershipManifest } from './ownership-manifest.mjs'
import { storybookAgentsSeams } from './storybook-ownership-agents-seams.mjs'
import { storybookContributingSeams } from './storybook-ownership-contributing-seams.mjs'
import { storybookCoreSeams } from './storybook-ownership-core-seams.mjs'
import { storybookGeneralDocSeams, storybookIndexSeams } from './storybook-ownership-doc-seams.mjs'
import { storybookFacts, storybookSurfaceRoots } from './storybook-ownership-facts.mjs'
import {
  storybookResidualSeams,
  storybookWorkflowResidualSeams,
} from './storybook-ownership-residual-seams.mjs'
import { storybookTestingSeams } from './storybook-ownership-testing-seams.mjs'

const retainedTestRationale = {
  id: 'storybook.section-error-test-rationale',
  path: 'apps/web/src/shared/ui/section-error-boundary.test.tsx',
  kind: 'file',
  cardinality: 'one',
  seamKind: 'owned-block',
  selector: {
    start: "  // when this case was tried here. `@storybook/nextjs-vite`'s",
    end: '  // this "needs the real Next runtime" class of case.',
  },
  detectors: ['@storybook/nextjs-vite'],
  disposition: 'retain',
}

export const storybookOwnership = defineOwnershipManifest({
  feature: 'storybook',
  tags: {
    topology: ['enabled', 'disabled'],
    verification: ['lint', 'typecheck', 'test', 'build'],
  },
  surfaceRoots: storybookSurfaceRoots,
  tsconfigs: ['apps/web/tsconfig.json'],
  testGlobs: ['apps/web/src/**/*.test.ts', 'apps/web/src/**/*.test.tsx'],
  monitoredIdentifiers: [
    '@storybook/nextjs-vite',
    'msw-storybook-addon',
    'test:storybook',
    'docs/frontend/storybook.md',
    'storybook-static',
  ],
  facts: storybookFacts,
  seams: [
    ...storybookCoreSeams,
    ...storybookIndexSeams,
    ...storybookGeneralDocSeams,
    ...storybookAgentsSeams,
    ...storybookContributingSeams,
    ...storybookTestingSeams,
    ...storybookResidualSeams,
    ...storybookWorkflowResidualSeams,
    retainedTestRationale,
  ],
})

export const STORYBOOK_CONTENT_PATHS = Object.freeze(
  [
    ...new Set(storybookOwnership.seams.flatMap((item) => (item.operationKey ? [item.path] : []))),
  ].sort()
)
