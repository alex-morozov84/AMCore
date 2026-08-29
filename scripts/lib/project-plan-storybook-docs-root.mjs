// init:project --storybook=disabled: the root README.md's doc-map row,
// index row, test-tooling sentence, and fork-onboarding callout mentions.
import path from 'node:path'
import { fileStep, removeExactBlock, replaceExactBlock } from './init-engine.mjs'

const FRONTEND_TESTING_ROW_BEFORE =
  '| Frontend testing      | [`docs/frontend/testing.md`](docs/frontend/testing.md) — Vitest/MSW, Storybook, Playwright mocked/server-mocked/real-stack lanes, and automated a11y scans                      |\n'

const FRONTEND_TESTING_ROW_AFTER =
  '| Frontend testing      | [`docs/frontend/testing.md`](docs/frontend/testing.md) — Vitest/MSW, Playwright mocked/server-mocked/real-stack lanes, and automated a11y scans                                  |\n'

const STORYBOOK_ROW =
  '| Storybook             | [`docs/frontend/storybook.md`](docs/frontend/storybook.md) — component workshop, story conventions, a11y gate, and maintenance procedures                                       |\n'

const ONBOARDING_FLAGS_BEFORE =
  '> `pnpm init:project` (single-locale and/or disabling Storybook) — see\n'

const ONBOARDING_FLAGS_AFTER = '> `pnpm init:project` (single-locale) — see\n'

const ONBOARDING_STRUCTURAL_BEFORE = `> flags. \`init:project\` records structural choices such as single-locale mode
> and Storybook removal. Still set by hand: where the
`

const ONBOARDING_STRUCTURAL_AFTER = `> flags. \`init:project\` records structural choices such as single-locale mode.
> Still set by hand: where the
`

const TOOLING_SENTENCE_BEFORE = `Tests use Jest for backend unit tests, Jest + Testcontainers for API E2E suites,
Vitest for React Email template rendering and frontend unit/integration tests,
Storybook for isolated component-state/interaction/a11y checks, Playwright for
frontend browser flows, and \`@axe-core/playwright\` for automated accessibility
scans. See [\`docs/frontend/testing.md\`](docs/frontend/testing.md) for the
frontend test taxonomy and command choices.
`

const TOOLING_SENTENCE_AFTER = `Tests use Jest for backend unit tests, Jest + Testcontainers for API E2E suites,
Vitest for React Email template rendering and frontend unit/integration tests,
Playwright for frontend browser flows, and \`@axe-core/playwright\` for automated
accessibility scans. See [\`docs/frontend/testing.md\`](docs/frontend/testing.md)
for the frontend test taxonomy and command choices.
`

export function buildStorybookDocsRootSteps(root) {
  return [
    fileStep(
      path.join(root, 'README.md'),
      (content) => {
        let next = replaceExactBlock(
          content,
          FRONTEND_TESTING_ROW_BEFORE,
          FRONTEND_TESTING_ROW_AFTER
        )
        next = removeExactBlock(next, STORYBOOK_ROW)
        next = replaceExactBlock(next, TOOLING_SENTENCE_BEFORE, TOOLING_SENTENCE_AFTER)
        next = replaceExactBlock(next, ONBOARDING_FLAGS_BEFORE, ONBOARDING_FLAGS_AFTER)
        return replaceExactBlock(next, ONBOARDING_STRUCTURAL_BEFORE, ONBOARDING_STRUCTURAL_AFTER)
      },
      'README.md: remove the Storybook doc-map row, index row, tooling mention, and onboarding-callout mentions'
    ),
  ]
}
