const entry = (id, path, selector, detectors = [id], extra = {}) => {
  return {
    id,
    path,
    kind: 'file',
    cardinality: 'one',
    seamKind: 'owned-block',
    selector,
    detectors,
    disposition: 'remove',
    ...extra,
  }
}

export const operationsConsoleDocSeams = [
  entry(
    'console.deploy-doc',
    'docs/operations/deployment.md',
    {
      start: '### Operations Console host-mode reference',
      end: '## Realtime SSE behind a proxy',
    },
    ['ADMIN_CONSOLE_HOSTNAME', '__Host-amcore_console_session', 'web:console-session:v1']
  ),
  entry(
    'console.sessions-doc',
    'docs/auth/sessions.md',
    {
      start: '## Operations Console host mode',
      end: '## Token rotation',
    },
    ['__Host-amcore_console_session', 'web:console-session:v1']
  ),
  entry(
    'console.csrf-doc',
    'docs/auth/csrf.md',
    {
      start: '## Operations Console host mode',
      end: '## Bull Board',
    },
    ['ADMIN_CONSOLE_HOSTNAME', '__Host-amcore_console_session']
  ),
  entry('console.auth-index-row', 'docs/auth/README.md', {
    text: '[Operations Console](../operations-console/README.md) | Separate',
  }),
  entry(
    'console.auth-index-copy',
    'docs/auth/README.md',
    {
      identifiers: ['__Host-amcore_console_session', 'web:console-session:v1'],
    },
    ['__Host-amcore_console_session', 'web:console-session:v1'],
    { occurrences: 2 }
  ),
  entry(
    'console.fsd-doc',
    'docs/frontend/architecture-and-conventions.md',
    {
      start: '### Operations Console shell',
      end: '## Browser security headers and CSP',
    },
    ['@/widgets/console-shell']
  ),
  entry('console.frontend-index-row', 'docs/frontend/README.md', {
    text: '[Operations Console](../operations-console/README.md)                   |',
  }),
  entry('console.frontend-start-link', 'docs/frontend/README.md', {
    text: '- Configuring or extending the Operations Console →',
  }),
  entry(
    'console.token-doc',
    'docs/frontend/brand-theme-and-tokens.md',
    {
      text: '`console-accent`',
    },
    ['--console-accent']
  ),
  entry(
    'console.scaffold-doc',
    'docs/frontend/brand-theme-and-tokens.md',
    {
      text: '`ADMIN_CONSOLE_HOSTNAME`',
    },
    ['ADMIN_CONSOLE_HOSTNAME'],
    { disposition: 'retain' }
  ),
  entry('console.resilience-doc', 'docs/frontend/server-rendered-resilience.md', {
    text: 'The Operations Console is the first planned in-repo consumer',
  }),
  entry('console.root-intro', 'README.md', {
    text: 'The optional [Operations Console](docs/operations-console/README.md)',
  }),
  entry('console.root-tree', 'README.md', {
    text: 'operations-console/ # SUPER_ADMIN console usage',
  }),
  entry('console.root-capability', 'README.md', {
    text: '| **Operations Console**   | ✅ Foundational',
  }),
  entry('console.root-map', 'README.md', {
    text: '| Operations Console                  | [`docs/operations-console/`',
  }),
  entry(
    'console.root-scaffold',
    'README.md',
    {
      text: '`ADMIN_CONSOLE_HOSTNAME`',
    },
    ['ADMIN_CONSOLE_HOSTNAME'],
    { disposition: 'retain' }
  ),
  entry('console.docs-intent', 'docs/README.md', {
    text: '| Configure, deploy, or safely extend Operations Console',
  }),
  entry('console.docs-index', 'docs/README.md', {
    text: '- **[Operations Console](operations-console/README.md)**',
  }),
  entry('console.operations-index', 'docs/operations/README.md', {
    text: '- **[Operations Console](../operations-console/README.md)**',
  }),
]
