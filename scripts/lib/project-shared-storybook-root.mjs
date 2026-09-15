import { removeExactBlock, replaceExactBlock } from './content-blocks.mjs'

const TEST_ROW_BEFORE = `| Frontend testing                    | [\`docs/frontend/testing.md\`](docs/frontend/testing.md) — Vitest/MSW, Storybook, Playwright mocked/server-mocked/real-stack lanes, and automated a11y scans                                                                                                                                                                                                                                                                                                                                                                                                       |
`
const TEST_ROW_AFTER = `| Frontend testing                    | [\`docs/frontend/testing.md\`](docs/frontend/testing.md) — Vitest/MSW, Playwright mocked/server-mocked/real-stack lanes, and automated a11y scans                                                                                                                                                                                                                                                                                                                                                                                                                  |
`
const STORYBOOK_ROW = `| Storybook                           | [\`docs/frontend/storybook.md\`](docs/frontend/storybook.md) — component workshop, story conventions, a11y gate, and maintenance procedures                                                                                                                                                                                                                                                                                                                                                                                                                        |
`
const FLAGS_BEFORE = `> \`pnpm init:project\` (single-locale, Storybook, or Operations Console shape,
> all one-time; route-progress's default is non-destructive)
> — see
`
const FLAGS_AFTER = `> \`pnpm init:project\` (single-locale or Operations Console shape, both
> one-time; route-progress's default is non-destructive) — see
`
const STRUCTURE_BEFORE = `> flags. \`init:project\` records project choices: structural single-locale
> mode/Storybook removal, the console \`disabled|path|host\` choice and optional
> page slug, plus the non-structural route-progress default. Console hostnames
> remain deployment configuration (\`ADMIN_CONSOLE_HOSTNAME\`), not a slug.
> Still set by hand: where the
`
const STRUCTURE_AFTER = `> flags. \`init:project\` records project choices: structural single-locale
> mode, the console \`disabled|path|host\` choice and optional page slug, plus the
> non-structural route-progress default. Console hostnames remain deployment
> configuration (\`ADMIN_CONSOLE_HOSTNAME\`), not a slug. Still set by hand: where the
`
const TOOLING_BEFORE = `Tests use Jest for backend unit tests, Jest + Testcontainers for API E2E suites,
Vitest for \`packages/shared\`'s own schema/lib contract tests, React Email
template rendering, and frontend unit/integration tests, Storybook for
isolated component-state/interaction/a11y checks, Playwright for frontend
browser flows, and \`@axe-core/playwright\` for automated accessibility scans.
See [\`docs/backend/architecture-and-conventions.md\`](docs/backend/architecture-and-conventions.md#2-contract-shared-zod)
for where a shared schema's own test belongs, and
[\`docs/frontend/testing.md\`](docs/frontend/testing.md) for the frontend test
taxonomy and command choices.
`
const TOOLING_AFTER = `Tests use Jest for backend unit tests, Jest + Testcontainers for API E2E suites,
Vitest for \`packages/shared\`'s own schema/lib contract tests, React Email
template rendering, and frontend unit/integration tests, Playwright for
frontend browser flows, and \`@axe-core/playwright\` for automated accessibility
scans. See [\`docs/backend/architecture-and-conventions.md\`](docs/backend/architecture-and-conventions.md#2-contract-shared-zod)
for where a shared schema's own test belongs, and
[\`docs/frontend/testing.md\`](docs/frontend/testing.md) for the frontend test
taxonomy and command choices.
`
const A11Y_BEFORE = `| **Accessibility (a11y)** | ✅ Shipped      | WCAG AA contrast enforced by a dependency-free test on the shipped token CSS, \`@axe-core/playwright\` WCAG A/AA scans on real pages, and a CI-gating Storybook a11y check per component      |
`
const A11Y_AFTER = `| **Accessibility (a11y)** | ✅ Shipped      | WCAG AA contrast enforced by a dependency-free test on the shipped token CSS, \`@axe-core/playwright\` WCAG A/AA scans on real pages                                                          |
`
const WORKSHOP_ROW = `| **Component workshop**   | ✅ Shipped      | Storybook wired to the same MSW/theme/i18n stack as the real app; every story doubles as a Vitest test with a CI-gating axe check                                                           |
`

export function removeStorybookRoot(content) {
  let next = replaceExactBlock(content, TEST_ROW_BEFORE, TEST_ROW_AFTER)
  next = removeExactBlock(next, STORYBOOK_ROW)
  next = replaceExactBlock(next, TOOLING_BEFORE, TOOLING_AFTER)
  next = replaceExactBlock(next, FLAGS_BEFORE, FLAGS_AFTER)
  next = replaceExactBlock(next, STRUCTURE_BEFORE, STRUCTURE_AFTER)
  next = replaceExactBlock(next, A11Y_BEFORE, A11Y_AFTER)
  return removeExactBlock(next, WORKSHOP_ROW)
}
