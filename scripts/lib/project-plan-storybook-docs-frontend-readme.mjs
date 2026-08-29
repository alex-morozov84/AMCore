// init:project --storybook=disabled: docs/frontend/README.md's index row,
// "Start here" bullet referencing the deleted storybook.md, and the
// scaffolding-discovery bullet's stale "disabling Storybook" mention.
import path from 'node:path'
import { fileStep, removeExactBlock, replaceExactBlock } from './init-engine.mjs'

const INDEX_ROW =
  "| [Storybook](./storybook.md)                                     | The component workshop: what's wired (a11y/theme/MSW/i18n decorators), story conventions, the CLI-safety/`optimizeDeps.include` rules, and running a fork without Storybook |\n"

const START_HERE_BULLET =
  '- Writing or reviewing a `shared/ui`/feature-flow story → [Storybook](./storybook.md)\n'

const SCAFFOLDING_BULLET_BEFORE = `- Initializing a downstream fork (\`pnpm init:brand\`/\`pnpm init:project\`:
  identity, single-locale, disabling Storybook) →
  [Brand, theme, and design tokens § Project scaffolding](./brand-theme-and-tokens.md#project-scaffolding)
`

const SCAFFOLDING_BULLET_AFTER = `- Initializing a downstream fork (\`pnpm init:brand\`/\`pnpm init:project\`:
  identity, single-locale) →
  [Brand, theme, and design tokens § Project scaffolding](./brand-theme-and-tokens.md#project-scaffolding)
`

export function buildStorybookDocsFrontendReadmeSteps(root) {
  return [
    fileStep(
      path.join(root, 'docs/frontend/README.md'),
      (content) => {
        const next = removeExactBlock(content, INDEX_ROW)
        const next2 = removeExactBlock(next, START_HERE_BULLET)
        return replaceExactBlock(next2, SCAFFOLDING_BULLET_BEFORE, SCAFFOLDING_BULLET_AFTER)
      },
      'docs/frontend/README.md: remove the Storybook index row, Start-here bullet, and stale scaffolding mention'
    ),
  ]
}
