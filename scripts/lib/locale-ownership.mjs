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
    'delegates to the service and returns the wrapped profile',
    'uses the explicit body locale over the negotiated header',
    'falls back to the negotiated Accept-Language locale when the body omits it',
    'renders detailed content only from the allowlisted projection (no raw payload leak)',
    'renderStored (version-aware, fail-closed)',
    'sends an org invite email with hasAccount=false for an unknown email',
    "prisma.user.findUnique.mockResolvedValue({ locale: 'en' } as never)",
    'renders items in the recipient locale and reports no more when within limit',
    'accepts supported locales and rejects others',
    "locale === 'en'",
  ],
  facts: localeOwnershipFacts,
  seams: localeOwnershipSeams,
})
