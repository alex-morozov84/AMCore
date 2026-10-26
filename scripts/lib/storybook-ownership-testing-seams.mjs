import { block, seam } from './storybook-ownership-seam-helpers.mjs'

const owned = (id, selector) =>
  seam(
    id,
    'docs/frontend/testing.md',
    'owned-block',
    selector,
    ['test:storybook', '@storybook/nextjs-vite', 'docs/frontend/storybook.md'],
    { operationKey: 'storybook.docs-testing' }
  )

export const storybookTestingSeams = [
  owned(
    'storybook.testing-intro',
    block(
      'Choose the test layer that proves the changed behavior: unit/component,',
      'uses a separate command because it needs Docker.',
      {
        replacement:
          'Choose the test layer that proves the changed behavior: unit/component,\n' +
          'integration, browser E2E or accessibility. Infrastructure integration\n' +
          'uses a separate command because it needs Docker.\n',
      }
    )
  ),
  owned(
    'storybook.testing-taxonomy',
    block('| Storybook             |', '`pnpm --filter web test:storybook` |')
  ),
  owned(
    'storybook.testing-command-rows',
    block('| `pnpm --filter web storybook`', '| `pnpm --filter web test:storybook`')
  ),
  owned(
    'storybook.testing-layer-guidance',
    block(
      "- Adding or changing a `shared/ui` primitive's variant/state, or a",
      '  experimental and deliberately not enabled here.'
    )
  ),
  owned('storybook.testing-see-also', {
    text: '- [Storybook](./storybook.md) — component-isolation states and their accessibility gate.',
  }),
  owned(
    'storybook.testing-error-boundary',
    block(
      "A `catchError` (`next/error`) boundary's actual catch-and-fallback behavior",
      '[Server-rendered graceful degradation](./server-rendered-resilience.md) for',
      {
        replacement:
          "A `catchError` (`next/error`) boundary's actual catch-and-fallback behavior\n" +
          'needs App Router client context that plain Vitest + Testing Library does not\n' +
          'initialize. Test the healthy case here; prove the thrown-child → fallback →\n' +
          '`retry()` path in a browser-capable component or E2E harness that supplies\n' +
          'that context. See `shared/ui/section-error-boundary.test.tsx` and\n' +
          '[Server-rendered graceful degradation](./server-rendered-resilience.md) for\n',
      }
    )
  ),
]
