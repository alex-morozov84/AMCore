// init:project --storybook=disabled: CONTRIBUTING.md's web test-command
// table rows and the shared-package-build paragraph that names the now-gone
// CI storybook job.
import path from 'node:path'
import { fileStep, removeExactBlock, replaceExactBlock } from './init-engine.mjs'

const COMMAND_ROWS =
  '| `pnpm --filter web storybook`           | Storybook component workshop dev server (`http://localhost:6006`)                                                                                            |\n' +
  '| `pnpm --filter web build-storybook`     | Static Storybook build — cheap compile/broken-story smoke                                                                                                    |\n' +
  '| `pnpm --filter web test:storybook`      | Storybook interaction + accessibility gate (browser-mode Vitest/Playwright Chromium)                                                                         |\n'

const BUILD_PARAGRAPH_BEFORE = `On a clean checkout, build the shared package before running Playwright or
Storybook's browser test runner directly: \`pnpm --filter @amcore/shared build\`.
The CI \`web-e2e\` and \`storybook\` jobs do this explicitly; turbo does it
automatically for \`pnpm test\`, \`pnpm lint\`, and \`pnpm typecheck\`.
`

const BUILD_PARAGRAPH_AFTER = `On a clean checkout, build the shared package before running Playwright
directly: \`pnpm --filter @amcore/shared build\`. The CI \`web-e2e\` job does
this explicitly; turbo does it automatically for \`pnpm test\`, \`pnpm lint\`,
and \`pnpm typecheck\`.
`

export function buildStorybookDocsContributingSteps(root) {
  return [
    fileStep(
      path.join(root, 'CONTRIBUTING.md'),
      (content) => {
        const next = removeExactBlock(content, COMMAND_ROWS)
        return replaceExactBlock(next, BUILD_PARAGRAPH_BEFORE, BUILD_PARAGRAPH_AFTER)
      },
      'CONTRIBUTING.md: remove the Storybook command rows and CI job mention'
    ),
  ]
}
