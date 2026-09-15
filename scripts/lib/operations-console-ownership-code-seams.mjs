const seam = (id, path, seamKind, selector, detectors, extra = {}) => ({
  id,
  path,
  kind: 'file',
  cardinality: 'one',
  seamKind,
  selector,
  detectors,
  disposition: 'remove',
  operationKey: id,
  ...extra,
})

export const operationsConsoleCodeSeams = [
  seam(
    'console.nginx-host',
    'docker/nginx/operations-console.conf',
    'owned-block',
    {
      start: '# AMCORE_ADMIN_CONSOLE_PROXY_START',
      end: '# AMCORE_ADMIN_CONSOLE_PROXY_END',
    },
    ['ADMIN_CONSOLE_HOSTNAME']
  ),
  seam(
    'console.startup-hook',
    'apps/web/src/instrumentation.ts',
    'structural-operation',
    { identifiers: ['validateAdminConsoleStartupOrExit'] },
    ['validateAdminConsoleStartupOrExit', 'feature-import'],
    {
      occurrences: 2,
      removeImports: ['apps/web/src/shared/lib/admin-console-startup.ts'],
    }
  ),
  seam(
    'console.tokens',
    'apps/web/src/app/globals.css',
    'structural-operation',
    { identifiers: ['--console-accent:', '--color-console-accent:', 'var(--console-accent)'] },
    ['--console-accent'],
    { occurrences: 4 }
  ),
  seam(
    'console.messages.en',
    'apps/web/messages/en.json',
    'config-field',
    { jsonPath: ['console'] },
    ['"console":'],
    { operationKey: 'messages-console' }
  ),
  seam(
    'console.messages.ru',
    'apps/web/messages/ru.json',
    'config-field',
    { jsonPath: ['console'] },
    ['"console":'],
    { operationKey: 'messages-console' }
  ),
  seam(
    'console.test-script',
    'apps/web/package.json',
    'config-field',
    { jsonPath: ['scripts', 'test:e2e:console-real-stack'] },
    ['test:e2e:console-real-stack'],
    { operationKey: 'package-console' }
  ),
  seam(
    'console.env-example',
    '.env.example',
    'owned-block',
    {
      start: '# For console host mode',
      end: '# ADMIN_CONSOLE_HOSTNAME="console.example.com"',
    },
    ['ADMIN_CONSOLE_HOSTNAME']
  ),
  seam(
    'console.compose-env',
    'docker-compose.yml',
    'structural-operation',
    { text: 'ADMIN_CONSOLE_HOSTNAME: ${ADMIN_CONSOLE_HOSTNAME:-}' },
    ['ADMIN_CONSOLE_HOSTNAME']
  ),
  seam(
    'console.context',
    'PROJECT_CONTEXT.md',
    'structural-operation',
    { identifiers: ['**admin_console:**', '**admin_console_mode:**', '**admin_console_slug:**'] },
    ['console-context-fields'],
    { occurrences: 3, disposition: 'rewrite', operationKey: 'context-console' }
  ),
  seam(
    'console.context-host-doc',
    'PROJECT_CONTEXT.md',
    'structural-operation',
    { text: '`ADMIN_CONSOLE_HOSTNAME`' },
    ['ADMIN_CONSOLE_HOSTNAME'],
    { disposition: 'retain' }
  ),
]
