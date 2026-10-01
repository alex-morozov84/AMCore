import { replaceExactBlock } from './content-blocks.mjs'

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

export function removeStorybookRoot(content) {
  let next = replaceRowText(
    content,
    '| Frontend testing ',
    'Vitest/MSW, Storybook, Playwright',
    'Vitest/MSW, Playwright'
  )
  next = mapTableRow(next, '| Storybook ', () => null)
  next = replaceExactBlock(next, TOOLING_BEFORE, TOOLING_AFTER)
  next = replaceExactBlock(next, FLAGS_BEFORE, FLAGS_AFTER)
  next = replaceExactBlock(next, STRUCTURE_BEFORE, STRUCTURE_AFTER)
  next = replaceRowText(
    next,
    '| **Accessibility (a11y)**',
    'Solid token-pair contrast tests, browser checks of destructive-button normal/hover states, real-page WCAG A/AA scans including retained Sessions refetch, and CI-gating Storybook a11y checks',
    'Solid token-pair contrast tests, real-page WCAG A/AA scans including retained Sessions refetch'
  )
  return mapTableRow(next, '| **Component workshop**', () => null)
}
