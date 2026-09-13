// init:project --storybook=disabled: docs/README.md's Storybook index row,
// the "Frontend testing" doc-map entry, and the scaffolding-discovery row's
// stale "disable Storybook" mention, all referencing the deleted storybook.md
// or a capability that no longer applies once this transform has run.
import path from 'node:path'
import { fileStep, removeExactBlock, replaceExactBlock } from './init-engine.mjs'

const INDEX_ROW =
  '| Write or review a Storybook story                                                        | [`frontend/storybook.md`](frontend/storybook.md)                                                                                  |\n'

const SCAFFOLDING_ROW_BEFORE =
  '| Initialize a downstream fork (rebrand, locale/Storybook shape, route-progress default)   | [`frontend/brand-theme-and-tokens.md`](frontend/brand-theme-and-tokens.md#project-scaffolding)                                    |\n'

const SCAFFOLDING_ROW_AFTER =
  '| Initialize a downstream fork (rebrand, locale shape, route-progress default)             | [`frontend/brand-theme-and-tokens.md`](frontend/brand-theme-and-tokens.md#project-scaffolding)                                    |\n'

const TESTING_MENTION_BEFORE = `- **[Frontend testing](frontend/testing.md)** — the test taxonomy
  (Vitest unit/component, MSW integration, Playwright mocked/server-mocked/
  real-stack E2E, Storybook, and axe scans), the technical boundary the E2E
  split is drawn on, and the tool-neutral runtime-verification workflow.
- **[Storybook](frontend/storybook.md)** — the \`shared/ui\`/feature-flow
  component workshop: decorators, story conventions, the accessibility
  gate, and the CLI-safety/\`optimizeDeps.include\` procedures.
`

const TESTING_MENTION_AFTER = `- **[Frontend testing](frontend/testing.md)** — the test taxonomy
  (Vitest unit/component, MSW integration, Playwright mocked/server-mocked/
  real-stack E2E, and axe scans), the technical boundary the E2E split is
  drawn on, and the tool-neutral runtime-verification workflow.
`

const BRAND_MAP_BEFORE = `  downstream rebrand checklist, and initializing a fork's locale, Storybook,
  route-progress, and Operations Console topology with \`pnpm init:brand\` /
  \`pnpm init:project\`.
`

const BRAND_MAP_AFTER = `  downstream rebrand checklist, and initializing a fork's locale, route-progress,
  and Operations Console topology with \`pnpm init:brand\` / \`pnpm init:project\`.
`

export function buildStorybookDocsReadmeSteps(root) {
  return [
    fileStep(
      path.join(root, 'docs/README.md'),
      (content) => {
        const next = removeExactBlock(content, INDEX_ROW)
        const next2 = replaceExactBlock(next, SCAFFOLDING_ROW_BEFORE, SCAFFOLDING_ROW_AFTER)
        const next3 = replaceExactBlock(next2, TESTING_MENTION_BEFORE, TESTING_MENTION_AFTER)
        return replaceExactBlock(next3, BRAND_MAP_BEFORE, BRAND_MAP_AFTER)
      },
      'docs/README.md: remove the Storybook index row and doc-map entry'
    ),
  ]
}
