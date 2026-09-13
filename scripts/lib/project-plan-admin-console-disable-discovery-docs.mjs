// Exact public-guide cleanup for the disabled Operations Console choice.
import path from 'node:path'
import { fileStep, removeExactBlock } from './init-engine.mjs'

const ROOT_BLOCK = [
  'The optional [Operations Console](docs/operations-console/README.md) is a',
  'separate, foundation-only `SUPER_ADMIN` control plane: its topology, session',
  'boundary, downstream scaffold choice, deployment, and safe extension recipe are',
  'documented there. It is not a product backoffice or a catalog/content admin UI.',
  '',
].join('\n')
const ROOT_DOC_MAP_ROW =
  '| Operations Console                  | [`docs/operations-console/`](docs/operations-console/README.md) — current SUPER_ADMIN-facing foundation, topology, session security, scaffolding, deployment, verification, and extension contract                                                                                                                                                                                                                                                                                                                                                               |\n'
const ROOT_CAPABILITY_ROW =
  '| **Operations Console**   | ✅ Foundational | Optional localized `SUPER_ADMIN` control-plane shell with path/host topology, isolated host sessions, downstream scaffold choice, and a documented extension contract                       |\n'
const ROOT_PROJECT_TREE_ROW =
  '│   ├── operations-console/ # SUPER_ADMIN console usage, configuration, deployment, and extension\n'

const DOCS_INDEX_ROW =
  '| Configure, deploy, or safely extend Operations Console                                   | [`operations-console/`](operations-console/README.md)                                                                             |\n'
const DOCS_INDEX_BLOCK = [
  '- **[Operations Console](operations-console/README.md)** — the optional',
  '  `SUPER_ADMIN` control-plane foundation: topology, host-session boundary,',
  '  downstream scaffold, deployment, verification, and safe extension rules.',
  '',
].join('\n')
const FRONTEND_START_BLOCK = [
  '- Configuring or extending the Operations Console →',
  '  [Operations Console](../operations-console/README.md)',
].join('\n')
const AUTH_INDEX_ROW =
  '| [Operations Console](../operations-console/README.md) | Separate `SUPER_ADMIN` control-plane admission and host session boundary |\n'
const OPERATIONS_INDEX_BLOCK = [
  '- **[Operations Console](../operations-console/README.md)** — optional',
  '  `SUPER_ADMIN` control-plane topology, host session boundary, scaffold choice,',
  '  proxy deployment, verification, and extension rules. The detailed nginx/Caddy',
  '  host-mode mappings remain in [Deployment & migrations](deployment.md#operations-console-host-mode-reference).',
  '',
].join('\n')

export function removeConsoleFrontendDiscoveryLink(content) {
  return removeExactBlock(content, FRONTEND_START_BLOCK)
}

export function removeConsoleRootGuideLink(content) {
  const withoutGuide = removeExactBlock(content, ROOT_BLOCK)
  const withoutMap = removeExactBlock(withoutGuide, ROOT_DOC_MAP_ROW)
  return removeExactBlock(removeExactBlock(withoutMap, ROOT_CAPABILITY_ROW), ROOT_PROJECT_TREE_ROW)
}

export function removeConsoleDocsIndexLinks(content) {
  return removeExactBlock(removeExactBlock(content, DOCS_INDEX_ROW), DOCS_INDEX_BLOCK)
}

export function removeConsoleAuthenticationIndexLink(content) {
  return removeExactBlock(content, AUTH_INDEX_ROW)
}

export function buildAdminConsoleDiscoveryDocsRemovalSteps(root) {
  return [
    fileStep(path.join(root, 'README.md'), removeConsoleRootGuideLink, 'remove console guide link'),
    fileStep(
      path.join(root, 'docs/README.md'),
      removeConsoleDocsIndexLinks,
      'remove console documentation index links'
    ),
    fileStep(
      path.join(root, 'docs/operations/README.md'),
      (content) => removeExactBlock(content, OPERATIONS_INDEX_BLOCK),
      'remove console operations index link'
    ),
  ]
}
