import { operationsConsoleCodeSeams } from './operations-console-ownership-code-seams.mjs'
import { operationsConsoleDocSeams } from './operations-console-ownership-doc-seams.mjs'
import {
  operationsConsoleFacts,
  operationsConsoleSurfaceRoots,
} from './operations-console-ownership-facts.mjs'
import { defineOwnershipManifest } from './ownership-manifest.mjs'

export const operationsConsoleOwnership = defineOwnershipManifest({
  feature: 'operations-console',
  tags: {
    topology: ['disabled', 'path', 'host'],
    verification: ['lint', 'typecheck', 'test', 'build', 'proxy-smoke'],
  },
  surfaceRoots: operationsConsoleSurfaceRoots,
  tsconfigs: ['apps/web/tsconfig.json'],
  testGlobs: [
    'apps/web/src/**/*.test.ts',
    'apps/web/src/**/*.test.tsx',
    'apps/web/e2e/**/*.spec.ts',
    'apps/web/src/**/*.stories.tsx',
  ],
  monitoredIdentifiers: [
    'ADMIN_CONSOLE_CONFIG',
    'validateAdminConsoleStartupOrExit',
    'requireSuperAdmin',
    'withConsoleHostGuard',
    'getConsolePublicApiPath',
    'getConsoleOverviewHref',
    '--console-accent',
    'ADMIN_CONSOLE_HOSTNAME',
    '__Host-amcore_console_session',
    'web:console-session:v1',
    'test:e2e:console-real-stack',
    '@/widgets/console-shell',
  ],
  facts: operationsConsoleFacts,
  seams: [...operationsConsoleCodeSeams, ...operationsConsoleDocSeams],
})
