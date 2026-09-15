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

const block = (start, end) => ({ start, end, consumeBlankLine: true })

export const operationsConsoleDiscoverySeams = [
  entry(
    'console.root-intro',
    'README.md',
    block(
      'The optional [Operations Console](docs/operations-console/README.md)',
      'It is not a product backoffice or a catalog/content admin UI.'
    ),
    undefined,
    { operationKey: 'readme-console' }
  ),
  entry(
    'console.root-tree',
    'README.md',
    { text: 'operations-console/ # SUPER_ADMIN console usage' },
    undefined,
    { operationKey: 'readme-console' }
  ),
  entry(
    'console.root-capability',
    'README.md',
    { text: '| **Operations Console**   | ✅ Foundational' },
    undefined,
    { operationKey: 'readme-console' }
  ),
  entry(
    'console.root-map',
    'README.md',
    { text: '| Operations Console                  | [`docs/operations-console/`' },
    undefined,
    { operationKey: 'readme-console' }
  ),
  entry(
    'console.root-scaffold',
    'README.md',
    { text: '`ADMIN_CONSOLE_HOSTNAME`' },
    ['ADMIN_CONSOLE_HOSTNAME'],
    { disposition: 'retain', operationKey: undefined }
  ),
  entry(
    'console.docs-intent',
    'docs/README.md',
    { text: '| Configure, deploy, or safely extend Operations Console' },
    undefined,
    { operationKey: 'docs-index-console' }
  ),
  entry(
    'console.docs-index',
    'docs/README.md',
    block(
      '- **[Operations Console](operations-console/README.md)**',
      'downstream scaffold, deployment, verification, and safe extension rules.'
    ),
    undefined,
    { operationKey: 'docs-index-console' }
  ),
  entry(
    'console.operations-index',
    'docs/operations/README.md',
    block(
      '- **[Operations Console](../operations-console/README.md)**',
      'host-mode mappings remain in [Deployment & migrations](deployment.md#operations-console-host-mode-reference).'
    )
  ),
]
