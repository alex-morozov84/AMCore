import { block, seam } from './storybook-ownership-seam-helpers.mjs'
import { STORYBOOK_PACKAGE_PATHS } from './project-shared-json-operations.mjs'

export const storybookCoreSeams = [
  seam(
    'context-storybook',
    'PROJECT_CONTEXT.md',
    'structural-operation',
    { identifiers: ['**frontend_storybook:**', 'docs/frontend/storybook.md', 'test:storybook'] },
    ['frontend_storybook', 'docs/frontend/storybook.md', 'test:storybook'],
    { occurrences: 3, disposition: 'rewrite' }
  ),
  seam(
    'project-eslint-remove-storybook',
    'apps/web/eslint.config.mjs',
    'structural-operation',
    { identifiers: ['eslint-plugin-storybook', 'storybook-static/**'] },
    ['eslint-plugin-storybook', 'storybook-static'],
    { occurrences: 2 }
  ),
  ...STORYBOOK_PACKAGE_PATHS.map((dottedPath, index) => {
    const jsonPath = dottedPath.split('.')
    const detector = jsonPath.at(-1)
    return seam(
      `storybook.package-field-${index + 1}`,
      'apps/web/package.json',
      'config-field',
      { jsonPath },
      [detector],
      { operationKey: 'package-storybook' }
    )
  }),
  seam(
    'storybook.vitest-project',
    'apps/web/vitest.config.ts',
    'structural-operation',
    {
      identifiers: [
        '@storybook/addon-vitest/vitest-plugin',
        "name: 'storybook'",
        'msw-storybook-addon',
        'test:storybook',
      ],
    },
    ['@storybook/nextjs-vite', 'msw-storybook-addon', 'test:storybook'],
    { occurrences: 4, disposition: 'rewrite' }
  ),
  seam(
    'storybook.workflow-ci',
    '.github/workflows/ci.yml',
    'owned-block',
    block(
      '# amcore:sentinel-block start=storybook-job',
      '# amcore:sentinel-block end=storybook-job'
    ),
    ['storybook-job', 'test:storybook', 'msw-storybook-addon']
  ),
  seam(
    'storybook.workflow-dependency-review',
    '.github/workflows/dependency-review.yml',
    'owned-block',
    block(
      '# amcore:sentinel-block start=storybook-allowlist',
      '# amcore:sentinel-block end=storybook-allowlist'
    ),
    ['storybook-allowlist', '@storybook/nextjs-vite']
  ),
  seam(
    'storybook.gitignore',
    'apps/web/.gitignore',
    'owned-block',
    block('# storybook', '*storybook.log'),
    ['storybook-static', '*storybook.log']
  ),
]
