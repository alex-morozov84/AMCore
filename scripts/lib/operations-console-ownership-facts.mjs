const one = (path, extra = {}) => ({ path, kind: 'file', cardinality: 'one', ...extra })
const dir = (path) => ({ path, kind: 'directory', cardinality: 'one' })
const many = (glob) => ({ glob, kind: 'file', cardinality: 'one-or-more' })
const module = (path, tests = []) => one(path, { tests })

const roots = [
  'apps/web/src/app/[locale]/admin',
  'apps/web/src/app/api/console',
  'apps/web/src/_pages/console',
  'apps/web/src/features/console-login',
  'apps/web/src/features/console-logout',
  'apps/web/src/shared/api/console',
  'apps/web/src/widgets/console-shell',
  'apps/web/e2e/console-real-stack',
  'docs/operations-console',
].map(dir)

const sharedModules = [
  module('apps/web/src/shared/lib/admin-console.generated.ts'),
  module('apps/web/src/shared/lib/admin-console-config.ts', ['admin-console-config.test.ts']),
  module('apps/web/src/shared/lib/admin-console-startup.ts'),
  module('apps/web/src/shared/lib/console-host-guard.ts', ['console-host-guard.test.ts']),
  module('apps/web/src/shared/lib/console-public-api-path.ts', ['console-public-api-path.test.ts']),
  module('apps/web/src/shared/lib/console-public-href.ts', ['console-public-href.test.ts']),
  module('apps/web/src/shared/lib/require-super-admin.ts', ['require-super-admin.test.ts']),
]

const verification = [
  'apps/web/playwright.console-real-stack.config.ts',
  'docker-compose.console-session-e2e.yml',
  'scripts/run-console-session-e2e.mjs',
  'scripts/run-console-single-locale-proxy-smoke.mjs',
  // Path-mode console e2e coverage - lives under the general `e2e/real-stack`
  // suite (not `e2e/console-real-stack`, which is host-mode's own isolated
  // stack) since path mode reuses the ordinary product session/stack. Still
  // wholly console-specific, so it is declared here rather than left as an
  // undetected contribution outside every closed root.
  'apps/web/e2e/real-stack/admin-helpers.ts',
  'apps/web/e2e/real-stack/admin-organizations.spec.ts',
  'apps/web/e2e/real-stack/admin-overview.spec.ts',
].map((path) => one(path, { tags: ['verification:console'] }))

const sharedModuleTests = sharedModules.flatMap((item) =>
  item.tests.map((test) => one(`apps/web/src/shared/lib/${test}`, { module: item.path }))
)

const featureEntrypoints = [
  'apps/web/src/app/[locale]/admin/(auth)/login/page.tsx',
  'apps/web/src/app/[locale]/admin/(protected)/layout.tsx',
  'apps/web/src/app/[locale]/admin/(protected)/page.tsx',
  'apps/web/src/app/[locale]/admin/layout.tsx',
  'apps/web/src/app/api/console/access/route.ts',
  'apps/web/src/app/api/console/auth/login/route.ts',
  'apps/web/src/app/api/console/auth/logout/route.ts',
].map(one)

const repositoryEntrypoints = [
  many('apps/web/src/app/**/page.tsx'),
  many('apps/web/src/app/**/layout.tsx'),
  many('apps/web/src/app/**/route.ts'),
  one('apps/web/src/app/[locale]/(dashboard)/error.tsx'),
  one('apps/web/src/app/manifest.ts'),
  one('apps/web/src/instrumentation.ts'),
  one('apps/web/src/proxy.ts'),
]

export const operationsConsoleFacts = {
  roots,
  featureFiles: [],
  sharedModules,
  sharedModuleTests,
  topology: ['docker-compose.console-host.yml', 'docker/caddy/Caddyfile.console-host'].map((path) =>
    one(path, { tags: ['topology:host'] })
  ),
  verification,
  documentation: [],
  featureEntrypoints,
  repositoryEntrypoints,
}

export const operationsConsoleSurfaceRoots = [
  'apps/web/src',
  'apps/web/e2e',
  'apps/web/messages',
  'apps/web/package.json',
  'apps/web/playwright.console-real-stack.config.ts',
  'docs',
  'docker',
  'docker-compose.yml',
  'docker-compose.console-host.yml',
  'docker-compose.console-session-e2e.yml',
  '.env.example',
  'README.md',
  'PROJECT_CONTEXT.md',
  'scripts/run-console-session-e2e.mjs',
  'scripts/run-console-single-locale-proxy-smoke.mjs',
]
