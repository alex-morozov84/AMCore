// init:project --storybook=disabled: CONTRIBUTING.md's web test-command
// table rows, the shared-package-build paragraph that names the now-gone
// CI storybook job, and the Development Commands table/flag-note mentions.
import path from 'node:path'
import { fileStep, removeExactBlock, replaceExactBlock } from './init-engine.mjs'

const INIT_PROJECT_ROW_BEFORE =
  '| `pnpm init:project` | Apply downstream structural choices such as single-locale mode or disabling Storybook |\n'

const INIT_PROJECT_ROW_AFTER =
  '| `pnpm init:project` | Apply downstream structural choices such as single-locale mode                        |\n'

const FLAG_NOTE_BEFORE = `\`pnpm init:project\` requires explicit flags. Use
\`--mode=single --locale=<code>\` to remove locale routing, and/or
\`--storybook=disabled\` to remove Storybook. See
`

const FLAG_NOTE_AFTER = `\`pnpm init:project\` requires explicit flags. Use
\`--mode=single --locale=<code>\` to remove locale routing. See
`

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
        let next = replaceExactBlock(content, INIT_PROJECT_ROW_BEFORE, INIT_PROJECT_ROW_AFTER)
        next = replaceExactBlock(next, FLAG_NOTE_BEFORE, FLAG_NOTE_AFTER)
        next = removeExactBlock(next, COMMAND_ROWS)
        return replaceExactBlock(next, BUILD_PARAGRAPH_BEFORE, BUILD_PARAGRAPH_AFTER)
      },
      'CONTRIBUTING.md: remove Storybook from init:project docs, command rows, and CI job mention'
    ),
  ]
}
