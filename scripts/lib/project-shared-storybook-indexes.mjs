import { removeExactBlock, replaceExactBlock } from './content-blocks.mjs'

function mapTableRow(content, prefix, edit) {
  const lines = content.split('\n')
  const matches = lines.flatMap((line, index) => (line.startsWith(prefix) ? [index] : []))
  if (matches.length !== 1) throw new Error(`expected exactly one ${prefix} table row`)
  const index = matches[0]
  const replacement = edit(lines[index])
  lines.splice(index, 1, ...(replacement === null ? [] : [replacement]))
  return lines.join('\n')
}

function replaceRowText(content, prefix, before, after) {
  return mapTableRow(content, prefix, (line) => {
    const changed = replaceExactBlock(line, before, after)
    return changed.slice(0, -1) + ' '.repeat(line.length - changed.length) + '|'
  })
}
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
  let next = mapTableRow(content, '| Write or review a Storybook story ', () => null)
  next = replaceRowText(
    next,
    '| Initialize a downstream fork (rebrand, ',
    'locale/Storybook/console shape',
    'locale/console shape'
  )
  next = replaceExactBlock(next, TESTING_BEFORE, TESTING_AFTER)
  return replaceExactBlock(next, BRAND_BEFORE, BRAND_AFTER)
}

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
  const withoutIndex = mapTableRow(content, '| [Storybook](./storybook.md)', () => null)
  const withoutStart = removeExactBlock(withoutIndex, FRONTEND_START)
  return replaceExactBlock(withoutStart, FRONTEND_SCAFFOLD_BEFORE, FRONTEND_SCAFFOLD_AFTER)
}

const ARCHITECTURE_BULLET =
  '- [Storybook](./storybook.md) — the component workshop and its own\n' +
  '  accessibility gate, a fifth layer of the testing pyramid above.\n'

export function removeStorybookArchitecture(content) {
  return removeExactBlock(content, ARCHITECTURE_BULLET)
}
