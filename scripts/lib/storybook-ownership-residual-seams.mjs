import { block, seam } from './storybook-ownership-seam-helpers.mjs'

const owned = (id, path, selector, detectors, operationKey = id) =>
  seam(id, path, 'owned-block', selector, detectors, { operationKey })

export const storybookResidualSeams = [
  owned(
    'storybook.brand-guide-link',
    'docs/frontend/brand-theme-and-tokens.md',
    block(
      '`--storybook=disabled` removes the Storybook surface, also **destructively**',
      '[Storybook § Downstream: disabling Storybook](./storybook.md#downstream-disabling-storybook));',
      {
        replacement:
          '`--storybook=disabled` removes the Storybook surface **destructively**;\n' +
          'the choice cannot be reversed by re-running the initializer;\n',
      }
    ),
    ['docs/frontend/storybook.md'],
    'storybook.docs-brand'
  ),
  owned(
    'storybook.brand-extension-contract',
    'docs/frontend/brand-theme-and-tokens.md',
    block(
      'The Storybook transform uses the same ownership contract:',
      'require narrow declared seams.'
    ),
    ['*.stories.tsx'],
    'storybook.docs-brand'
  ),
  owned(
    'storybook.route-progress-visuals',
    'docs/frontend/route-progress.md',
    block(
      'and reduced-motion behavior in a real browser. Storybook',
      'does not implement `onNavigate`.',
      { replacement: 'and reduced-motion behavior in a real browser.\n' }
    ),
    ['@storybook/nextjs-vite'],
    'storybook.docs-route-progress'
  ),
  owned(
    'storybook.console-development-step',
    'docs/operations-console/development.md',
    block(
      'Add focused unit tests, Storybook/a11y states where applicable, and',
      '   browser/real-stack coverage for auth, cookies, Redis, or proxy behavior.',
      {
        preserveStartPrefix: true,
        replacement:
          'Add focused unit tests and browser/real-stack coverage for visible states,\n' +
          'accessibility, auth, cookies, Redis, or proxy behavior as applicable.\n',
      }
    ),
    ['test:storybook'],
    'storybook.docs-console-development'
  ),
  owned(
    'storybook.console-testing-link',
    'docs/operations-console/development.md',
    block(
      '- [Frontend testing](../frontend/testing.md) explains unit, Storybook, browser,',
      '  and real-stack layers.',
      {
        replacement:
          '- [Frontend testing](../frontend/testing.md) explains unit, browser,\n' +
          '  accessibility, and real-stack layers.\n',
      }
    ),
    ['test:storybook'],
    'storybook.docs-console-development'
  ),
  owned(
    'storybook.console-test-command',
    'docs/operations-console/development.md',
    { text: '- Run `pnpm --filter web test:storybook` for component interaction and a11y' },
    ['test:storybook'],
    'storybook.docs-console-development'
  ),
]

export const storybookWorkflowResidualSeams = []
