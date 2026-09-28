import { block, seam } from './storybook-ownership-seam-helpers.mjs'

const owned = (id, selector) =>
  seam(id, 'CONTRIBUTING.md', 'owned-block', selector, ['test:storybook'], {
    operationKey: 'storybook.docs-contributing',
  })

export const storybookContributingSeams = [
  owned(
    'storybook.contributing-command-row',
    block('| `pnpm init:project`', '| Apply downstream project choices:', {
      replacement:
        '| `pnpm init:project`                                               | Apply downstream project choices: locale mode, route-progress default, and Operations Console topology                                                                                                                                               |\n',
    })
  ),
  owned(
    'storybook.contributing-flag-note',
    block(
      '`pnpm init:project` requires at least one explicit flag, in any combination:',
      "route-progress bar's default (non-destructive, unlike the other two). See",
      {
        replacement:
          '`pnpm init:project` requires at least one explicit flag, in any combination:\n' +
          '`--mode=single --locale=<code>` to remove locale routing, and/or\n' +
          "`--route-progress=disabled` to turn off the top route-progress bar's\n" +
          'default (non-destructive, unlike the other two). See\n',
      }
    )
  ),
  owned(
    'storybook.contributing-command-rows',
    block('| `pnpm --filter web storybook`', '| `pnpm --filter web test:storybook`', {
      consumeBlankLine: false,
    })
  ),
  owned(
    'storybook.contributing-build-note',
    block(
      "On a clean checkout, build the shared package before running Storybook's browser",
      '`pnpm lint`, and `pnpm typecheck`. Managed Playwright commands prepare their own',
      {
        replacement: 'Managed Playwright commands prepare their own\n',
      }
    )
  ),
]
