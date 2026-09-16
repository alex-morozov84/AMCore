import { defineOwnershipManifest } from './ownership-manifest.mjs'
import { localeOwnershipFacts, localeSurfaceRoots } from './locale-ownership-facts.mjs'
import { localeOwnershipSeams } from './locale-ownership-seams.mjs'

export const localeOwnership = defineOwnershipManifest({
  feature: 'single-locale-projection',
  tags: {
    topology: ['multi', 'single'],
    verification: ['lint', 'typecheck', 'test', 'build'],
  },
  surfaceRoots: localeSurfaceRoots,
  tsconfigs: ['apps/api/tsconfig.json', 'apps/web/tsconfig.json', 'packages/shared/tsconfig.json'],
  testGlobs: [
    'apps/api/src/**/*.spec.ts',
    'apps/web/src/**/*.test.ts',
    'apps/web/src/**/*.test.tsx',
    'packages/shared/src/**/*.test.ts',
  ],
  monitoredIdentifiers: [
    'NAVIGATION_PATHS',
    'project/import-guards-navigation-source',
    'dynamic-catalogue-import',
    'EmailVerificationEmail(baseProps)',
    'OrgInviteEmail({ ...baseProps, hasAccount: true })',
    'PasswordResetEmail(baseProps)',
  ],
  facts: localeOwnershipFacts,
  seams: localeOwnershipSeams,
})
