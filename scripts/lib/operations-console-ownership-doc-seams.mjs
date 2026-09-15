const entry = (id, path, selector, detectors = [id], extra = {}) => ({
  id,
  path,
  kind: 'file',
  cardinality: 'one',
  seamKind: 'owned-block',
  selector,
  detectors,
  disposition: 'remove',
  operationKey: id,
  ...extra,
})

const section = (start, end) => ({ start, end, retainEnd: true })
const block = (start, end) => ({ start, end, consumeBlankLine: true })

export const operationsConsoleDocSeams = [
  entry(
    'console.deploy-doc',
    'docs/operations/deployment.md',
    section('### Operations Console host-mode reference', '## Realtime SSE behind a proxy'),
    ['ADMIN_CONSOLE_HOSTNAME', '__Host-amcore_console_session', 'web:console-session:v1']
  ),
  entry(
    'console.sessions-doc',
    'docs/auth/sessions.md',
    section('## Operations Console host mode', '## Token rotation'),
    ['__Host-amcore_console_session', 'web:console-session:v1']
  ),
  entry(
    'console.csrf-doc',
    'docs/auth/csrf.md',
    section('## Operations Console host mode', '## Bull Board'),
    ['ADMIN_CONSOLE_HOSTNAME', '__Host-amcore_console_session']
  ),
  entry(
    'console.auth-index-row',
    'docs/auth/README.md',
    { text: '[Operations Console](../operations-console/README.md) | Separate' },
    undefined,
    { operationKey: 'console.auth-index' }
  ),
  entry(
    'console.auth-index-copy',
    'docs/auth/README.md',
    {
      start: 'When the optional Operations Console uses its separate host mode, it has a',
      end: '[CSRF Posture](./csrf.md#operations-console-host-mode).',
    },
    ['__Host-amcore_console_session', 'web:console-session:v1'],
    { operationKey: 'console.auth-index' }
  ),
  entry(
    'console.fsd-doc',
    'docs/frontend/architecture-and-conventions.md',
    section('### Operations Console shell', '## Browser security headers and CSP'),
    ['@/widgets/console-shell'],
    { operationKey: 'architecture-console' }
  ),
  entry(
    'console.frontend-index-row',
    'docs/frontend/README.md',
    { text: '[Operations Console](../operations-console/README.md)                   |' },
    undefined,
    { operationKey: 'frontend-index-console' }
  ),
  entry(
    'console.frontend-start-link',
    'docs/frontend/README.md',
    {
      start: '- Configuring or extending the Operations Console →',
      end: '  [Operations Console](../operations-console/README.md)',
      preserveFinalNewline: true,
    },
    undefined,
    { operationKey: 'frontend-index-console' }
  ),
  entry(
    'console.token-doc',
    'docs/frontend/brand-theme-and-tokens.md',
    { text: '`console-accent`' },
    ['--console-accent']
  ),
  entry(
    'console.scaffold-doc',
    'docs/frontend/brand-theme-and-tokens.md',
    {
      start: '`--admin-console=disabled|path|host` chooses the optional Operations Console:',
      end: 'and linked tests used only by the Console are removed together.',
    },
    ['ADMIN_CONSOLE_HOSTNAME', 'Console transform derives removal ownership'],
    { disposition: 'retain', operationKey: undefined }
  ),
  entry(
    'console.resilience-doc',
    'docs/frontend/server-rendered-resilience.md',
    block(
      'The Operations Console is the first planned in-repo consumer',
      'add durable browser coverage with real sections.'
    )
  ),
  ...operationsConsoleDiscoverySeams,
]
import { operationsConsoleDiscoverySeams } from './operations-console-ownership-discovery-seams.mjs'
