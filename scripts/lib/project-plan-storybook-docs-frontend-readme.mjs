// init:project --storybook=disabled: docs/frontend/README.md's index row and
// "Start here" bullet referencing the deleted storybook.md.
import path from 'node:path'
import { fileStep, removeExactBlock } from './init-engine.mjs'

const INDEX_ROW =
  "| [Storybook](./storybook.md)                                     | The component workshop: what's wired (a11y/theme/MSW/i18n decorators), story conventions, the CLI-safety and `optimizeDeps.include` rules  |\n"

const START_HERE_BULLET =
  '- Writing or reviewing a `shared/ui`/feature-flow story → [Storybook](./storybook.md)\n'

export function buildStorybookDocsFrontendReadmeSteps(root) {
  return [
    fileStep(
      path.join(root, 'docs/frontend/README.md'),
      (content) => {
        const next = removeExactBlock(content, INDEX_ROW)
        return removeExactBlock(next, START_HERE_BULLET)
      },
      'docs/frontend/README.md: remove the Storybook index row and Start-here bullet'
    ),
  ]
}
