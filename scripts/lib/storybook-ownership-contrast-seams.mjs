import { block, seam } from './storybook-ownership-seam-helpers.mjs'

export const storybookContrastSeams = [
  seam(
    'storybook.destructive-hover-proof',
    'docs/frontend/brand-theme-and-tokens.md',
    'owned-block',
    block(
      '  transparency. The browser [Storybook checks]',
      '  the variant; a passing solid-token check alone is insufficient.',
      {
        replacement:
          '  transparency. Verify normal/hover text on actual body, card and popover\n' +
          '  surfaces and confirmation actions in both themes when changing this\n' +
          '  variant; a passing solid-token check alone is insufficient.\n',
      }
    ),
    ['docs/frontend/storybook.md'],
    { operationKey: 'storybook.docs-brand' }
  ),
  seam(
    'storybook.destructive-component-command',
    'docs/frontend/shared-ui-and-shadcn.md',
    'owned-block',
    block(
      'opaque destructive fill and semantic hover mixture, and run the actual',
      'them; a named token can still fail contrast when opacity or compositing changes.',
      {
        replacement:
          'opaque destructive fill and semantic hover mixture. Verify normal/hover\n' +
          'contrast on actual body/card/popover surfaces and confirmation actions\n' +
          'in both themes. Solid-token checks do not cover opacity or compositing.\n',
      }
    ),
    ['button-contrast.stories.tsx'],
    { operationKey: 'storybook.docs-shared-ui' }
  ),
]
