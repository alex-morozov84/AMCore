// Exact console-only documentation/config cleanup for --admin-console=disabled.
import path from 'node:path'
import { fileStep, removeExactBlock, removeMarkdownSection } from './init-engine.mjs'
import {
  buildAdminConsoleDiscoveryDocsRemovalSteps,
  removeConsoleFrontendDiscoveryLink,
} from './project-plan-admin-console-disable-discovery-docs.mjs'

const AUTH_README_BLOCK = [
  'When the optional Operations Console uses its separate host mode, it has a',
  'second, deliberately isolated BFF boundary: `__Host-amcore_console_session`',
  'points only to `web:console-session:v1:*` entries carrying the `console`',
  'audience. It is not a product session and cannot authenticate product BFF',
  'routes; conversely, `amcore_session` cannot admit the console. See',
  '[Sessions](./sessions.md#operations-console-host-mode) and',
  '[CSRF Posture](./csrf.md#operations-console-host-mode).',
  '',
].join('\n')

const CONSOLE_TOKEN_ROW =
  '| Operations Console | `console-accent`                                                                                  | Functional system-control-plane signal for active console navigation, live-status indication, and links; it is not a product brand token |\n'
const CONSOLE_INDEX_ROW =
  '| [Operations Console](../operations-console/README.md)                                                             | The isolated `SUPER_ADMIN` control-plane foundation: FSD ownership, topology, session boundary, deployment, verification, and extension rules                                                                                                                                                                                           |\n'
const ENV_BLOCK = [
  '# For console host mode use docker-compose.console-host.yml as well; it requires',
  '# both CADDY_WEB_DOMAIN and ADMIN_CONSOLE_HOSTNAME.',
  '# ADMIN_CONSOLE_HOSTNAME="console.example.com"',
  '',
].join('\n')

export function removeConsoleArchitectureSection(content) {
  return removeMarkdownSection(
    content,
    '### Operations Console shell\n',
    '## Browser security headers and CSP\n'
  )
}

export function removeConsoleFrontendIndexRow(content) {
  return removeConsoleFrontendDiscoveryLink(removeExactBlock(content, CONSOLE_INDEX_ROW))
}

export function buildAdminConsoleDisableDocsSteps(root) {
  return [
    fileStep(
      path.join(root, 'docs/operations/deployment.md'),
      (content) =>
        removeMarkdownSection(
          content,
          '### Operations Console host-mode reference\n',
          '## Realtime SSE behind a proxy\n'
        ),
      'remove the Operations Console host-mode deployment reference'
    ),
    fileStep(
      path.join(root, 'docs/auth/sessions.md'),
      (content) =>
        removeMarkdownSection(content, '## Operations Console host mode\n', '## Token rotation\n'),
      'remove the Operations Console session section'
    ),
    fileStep(
      path.join(root, 'docs/auth/csrf.md'),
      (content) =>
        removeMarkdownSection(content, '## Operations Console host mode\n', '## Bull Board\n'),
      'remove the Operations Console CSRF section'
    ),
    fileStep(
      path.join(root, 'docs/auth/README.md'),
      (content) => removeExactBlock(content, AUTH_README_BLOCK),
      'remove the Operations Console authentication overview'
    ),
    fileStep(
      path.join(root, 'docs/frontend/architecture-and-conventions.md'),
      removeConsoleArchitectureSection,
      'remove the Operations Console FSD section'
    ),
    fileStep(
      path.join(root, 'docs/frontend/README.md'),
      removeConsoleFrontendIndexRow,
      'remove the Operations Console frontend index entry'
    ),
    fileStep(
      path.join(root, 'docs/frontend/brand-theme-and-tokens.md'),
      (content) => removeExactBlock(content, CONSOLE_TOKEN_ROW),
      'remove the console-only design-token documentation'
    ),
    fileStep(
      path.join(root, 'docs/frontend/server-rendered-resilience.md'),
      (content) =>
        removeExactBlock(
          content,
          'The Operations Console is the first planned in-repo consumer of the secondary\npath. Its queue, AI-approval, and audit panels must reuse these primitives and\nadd durable browser coverage with real sections.\n'
        ),
      'remove the console-specific resilience follow-up'
    ),
    fileStep(
      path.join(root, '.env.example'),
      (content) => removeExactBlock(content, ENV_BLOCK),
      'remove the console host environment sample'
    ),
    fileStep(
      path.join(root, 'docker-compose.yml'),
      (content) =>
        removeExactBlock(content, '      ADMIN_CONSOLE_HOSTNAME: ${ADMIN_CONSOLE_HOSTNAME:-}\n'),
      'remove the console hostname from the web container environment'
    ),
    ...buildAdminConsoleDiscoveryDocsRemovalSteps(root),
  ]
}
