import { block, seam } from './storybook-ownership-seam-helpers.mjs'

const owned = (id, path, selector, detectors, operationKey = id) =>
  seam(id, path, 'owned-block', selector, detectors, { operationKey })

export const storybookIndexSeams = [
  owned(
    'storybook.root-index',
    'README.md',
    block(
      '| Storybook                           |',
      'component workshop, story conventions, a11y gate, and maintenance procedures'
    ),
    ['docs/frontend/storybook.md'],
    'readme-storybook'
  ),
  owned(
    'storybook.docs-index',
    'docs/README.md',
    { text: '| Write or review a Storybook story' },
    ['docs/frontend/storybook.md'],
    'docs-index-storybook'
  ),
  owned(
    'storybook.frontend-index',
    'docs/frontend/README.md',
    { text: '| [Storybook](./storybook.md)' },
    ['docs/frontend/storybook.md'],
    'frontend-index-storybook'
  ),
  owned(
    'storybook.architecture-index',
    'docs/frontend/architecture-and-conventions.md',
    block(
      '- [Storybook](./storybook.md)',
      '  accessibility gate, a fifth layer of the testing pyramid above.'
    ),
    ['docs/frontend/storybook.md'],
    'architecture-storybook'
  ),
]

export const storybookGeneralDocSeams = [
  owned(
    'storybook.shared-ui-guide',
    'docs/frontend/shared-ui-and-shadcn.md',
    block(
      'Vitest + React Testing Library, matching the existing pattern in',
      'file in the same PR; `test:storybook` is a CI gate in strict upstream mode.',
      {
        replacement:
          'Vitest + React Testing Library, matching the existing pattern in\n' +
          '`button.test.tsx`/`skeleton.test.tsx`/`dialog.test.tsx`: render the\n' +
          'component, assert on `data-slot`/`data-variant` attributes and behavior\n' +
          '(click, open/close, variant switching), not implementation detail.\n',
      }
    ),
    ['test:storybook', 'docs/frontend/storybook.md'],
    'storybook.docs-shared-ui'
  ),
  owned(
    'storybook.ci-security-example',
    'docs/operations/ci-security.md',
    block('Current example: `image-size@2.0.2`', '`.github/workflows/dependency-review.yml`.', {
      consumeBlankLine: true,
    }),
    ['@storybook/nextjs-vite'],
    'storybook.docs-ci-security'
  ),
]
