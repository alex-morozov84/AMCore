import { removeExactBlock, replaceExactBlock } from './content-blocks.mjs'

const DOCS_INDEX_ROW =
  '| Write or review a Storybook story                                                        | [`frontend/storybook.md`](frontend/storybook.md)                                                                                  |\n'
const SCAFFOLDING_ROW_BEFORE =
  '| Initialize a downstream fork (rebrand, locale/Storybook/console shape, route-progress)   | [`frontend/brand-theme-and-tokens.md`](frontend/brand-theme-and-tokens.md#project-scaffolding)                                    |\n'
const SCAFFOLDING_ROW_AFTER =
  '| Initialize a downstream fork (rebrand, locale/console shape, route-progress)             | [`frontend/brand-theme-and-tokens.md`](frontend/brand-theme-and-tokens.md#project-scaffolding)                                    |\n'
const TESTING_BEFORE = `- **[Frontend testing](frontend/testing.md)** — the test taxonomy
  (Vitest unit/component, MSW integration, Playwright mocked/server-mocked/
  real-stack E2E, Storybook, and axe scans), the technical boundary the E2E
  split is drawn on, and the tool-neutral runtime-verification workflow.
- **[Storybook](frontend/storybook.md)** — the \`shared/ui\`/feature-flow
  component workshop: decorators, story conventions, the accessibility
  gate, and the CLI-safety/\`optimizeDeps.include\` procedures.
`
const TESTING_AFTER = `- **[Frontend testing](frontend/testing.md)** — the test taxonomy
  (Vitest unit/component, MSW integration, Playwright mocked/server-mocked/
  real-stack E2E, and axe scans), the technical boundary the E2E split is
  drawn on, and the tool-neutral runtime-verification workflow.
`
const BRAND_BEFORE = `  downstream rebrand checklist, and initializing a fork's locale, Storybook,
  route-progress, and Operations Console topology with \`pnpm init:brand\` /
  \`pnpm init:project\`.
`
const BRAND_AFTER = `  downstream rebrand checklist, and initializing a fork's locale, route-progress,
  and Operations Console topology with \`pnpm init:brand\` / \`pnpm init:project\`.
`

export function removeStorybookDocsIndex(content) {
  let next = removeExactBlock(content, DOCS_INDEX_ROW)
  next = replaceExactBlock(next, SCAFFOLDING_ROW_BEFORE, SCAFFOLDING_ROW_AFTER)
  next = replaceExactBlock(next, TESTING_BEFORE, TESTING_AFTER)
  return replaceExactBlock(next, BRAND_BEFORE, BRAND_AFTER)
}

const FRONTEND_INDEX_ROW =
  "| [Storybook](./storybook.md)                                             | The component workshop: what's wired (a11y/theme/MSW/i18n decorators), story conventions, the CLI-safety/`optimizeDeps.include` rules, and running a fork without Storybook                                                                                                                                                            |\n"
const FRONTEND_START =
  '- Writing or reviewing a `shared/ui`/feature-flow story → [Storybook](./storybook.md)\n'
const FRONTEND_SCAFFOLD_BEFORE = `- Initializing a downstream fork (\`pnpm init:brand\`/\`pnpm init:project\`:
  identity, locale/Storybook shape, route-progress default) →
  [Brand, theme, and design tokens § Project scaffolding](./brand-theme-and-tokens.md#project-scaffolding)
`
const FRONTEND_SCAFFOLD_AFTER = `- Initializing a downstream fork (\`pnpm init:brand\`/\`pnpm init:project\`:
  identity, locale shape, route-progress default) →
  [Brand, theme, and design tokens § Project scaffolding](./brand-theme-and-tokens.md#project-scaffolding)
`

export function removeStorybookFrontendIndex(content) {
  const withoutIndex = removeExactBlock(content, FRONTEND_INDEX_ROW)
  const withoutStart = removeExactBlock(withoutIndex, FRONTEND_START)
  return replaceExactBlock(withoutStart, FRONTEND_SCAFFOLD_BEFORE, FRONTEND_SCAFFOLD_AFTER)
}

const ARCHITECTURE_BULLET =
  '- [Storybook](./storybook.md) — the component workshop and its own\n' +
  '  accessibility gate, a fifth layer of the testing pyramid above.\n'

export function removeStorybookArchitecture(content) {
  return removeExactBlock(content, ARCHITECTURE_BULLET)
}
