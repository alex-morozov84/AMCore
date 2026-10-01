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
    { text: '| [Operations Console](../operations-console/README.md)' },
    undefined,
    { operationKey: 'frontend-index-console' }
  ),
  entry(
    'console.frontend-start-link',
    'docs/frontend/README.md',
    {
      start: '- Using, configuring, or extending the Operations Console →',
      end: '  [Operations Console](../operations-console/README.md)',
      preserveFinalNewline: true,
    },
    undefined,
    { operationKey: 'frontend-index-console' }
  ),
  entry(
    'console.agents-doc-map',
    'AGENTS.md',
    block(
      '- `docs/operations-console/` — using, configuring, deploying, and safely',
      '  [`docs/operations-console/README.md`](docs/operations-console/README.md).'
    ),
    ['docs/operations-console/README.md'],
    { operationKey: 'agents-console' }
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
      "The Operations Console's Organizations panel is the first real in-repo",
      'coverage over real sections.'
    )
  ),
  entry(
    'console.sessions-location-link',
    'docs/auth/sessions.md',
    block(
      'The optional Console also displays this metadata; see the',
      '[session presentation](../operations-console/users.md#manage-sessions).'
    ),
    undefined,
    { operationKey: 'console.sessions-doc' }
  ),
  entry(
    'console.sessions-operator-link',
    'docs/auth/sessions.md',
    block(
      'The optional Console provides the same operations through its Sessions panel:',
      '[Operations Console → Users](../operations-console/users.md#manage-sessions).'
    ),
    undefined,
    { operationKey: 'console.sessions-doc' }
  ),
  entry(
    'console.geoip-operator-link',
    'docs/operations/geoip-setup.md',
    block(
      "The optional Console's user Sessions panel also shows this information; see",
      '[Operations Console → Users § Manage sessions](../operations-console/users.md#manage-sessions).'
    )
  ),
  entry(
    'console.docs-session-actions',
    'docs/README.md',
    block(
      'The optional [Console actions](operations-console/users.md#manage-sessions)',
      'provide an operator interface for admin session management.'
    )
  ),
  entry(
    'console.api-token-resolver-doc',
    'docs/frontend/api-consumption.md',
    block(
      'The optional Operations Console supplies this override through',
      "(ADR-081's host/path session split)."
    )
  ),
  entry(
    'console.query-state-doc',
    'docs/frontend/architecture-and-conventions.md',
    block(
      "The optional Console's User Detail page uses this split for its Sessions card",
      "fetches follow ADR-079's primary/secondary graceful-degradation contract."
    )
  ),
  entry(
    'console.sessions-readability-guide',
    'docs/frontend/testing.md',
    block(
      'When the optional Console is enabled, its retained-refetch tests cover desktop',
      'Use the same isolated-stack configuration for these Console checks.'
    ),
    ['admin-sessions/readability.spec.ts']
  ),
  entry(
    'console.audit-history-guide',
    'docs/operations/audit-log.md',
    block(
      'With the optional Console, filter IDs and the cursor still appear in the',
      'configuration](../operations-console/configuration.md#console-urls-in-browser-history-and-logs).'
    ),
    ['../operations-console/configuration.md']
  ),
  entry(
    'console.rbac-user-guide',
    'docs/auth/rbac.md',
    block(
      "The Operations Console's Users panel is an authenticated management surface",
      'last-`SUPER_ADMIN` guards described above.'
    ),
    ['../operations-console/users.md']
  ),
  entry(
    'console.stand-commands',
    'docs/operations/local-stands.md',
    block(
      '<!-- AMCORE_CONSOLE_STAND_COMMANDS_START -->',
      '<!-- AMCORE_CONSOLE_STAND_COMMANDS_END -->'
    ),
    ['test:e2e:console-real-stack', 'console-real-stack']
  ),
  entry(
    'console.stand-profile',
    'docs/operations/local-stands.md',
    block(
      '<!-- AMCORE_CONSOLE_STAND_PROFILE_START -->',
      '<!-- AMCORE_CONSOLE_STAND_PROFILE_END -->'
    ),
    undefined,
    { operationKey: 'console.stand-commands' }
  ),
  entry(
    'console.stand-origin',
    'docs/operations/local-stands.md',
    block('<!-- AMCORE_CONSOLE_STAND_ORIGIN_START -->', '<!-- AMCORE_CONSOLE_STAND_ORIGIN_END -->'),
    ['ADMIN_CONSOLE_HOSTNAME', 'ADMIN_CONSOLE_ORIGIN']
  ),
  entry(
    'console.stand-table',
    'docs/operations/local-stands.md',
    { start: '| HTTPS Console host stack', end: '| Fresh disposable host-mode database' },
    ['console-real-stack']
  ),
  ...operationsConsoleDiscoverySeams,
]
import { operationsConsoleDiscoverySeams } from './operations-console-ownership-discovery-seams.mjs'
