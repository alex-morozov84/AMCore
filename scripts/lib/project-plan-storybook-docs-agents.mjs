// init:project --storybook=disabled: AGENTS.md's "## Testing" paragraph, the
// Operating-context fork-init bullet, and the Commands section's flag note.
import path from 'node:path'
import { fileStep, replaceExactBlock } from './init-engine.mjs'

const OPERATING_CONTEXT_BEFORE = `   and ask the owner to initialize it. The supported fork-initialization path is
   \`pnpm init:brand\` first, then \`pnpm init:project --mode=single --locale=<code>\`
   and/or \`pnpm init:project --storybook=disabled\` only if the fork wants those
   one-time structural choices; see
   \`docs/frontend/brand-theme-and-tokens.md#project-scaffolding\`.
`

const OPERATING_CONTEXT_AFTER = `   and ask the owner to initialize it. The supported fork-initialization path is
   \`pnpm init:brand\` first, then \`pnpm init:project --mode=single --locale=<code>\`
   only if the fork wants that one-time structural choice; see
   \`docs/frontend/brand-theme-and-tokens.md#project-scaffolding\`.
`

const COMMANDS_NOTE_BEFORE = `\`pnpm init:project\` is intentionally flag-driven: use
\`--mode=single --locale=<code>\` to remove locale routing, and/or
\`--storybook=disabled\` to remove Storybook from a fork.
`

const COMMANDS_NOTE_AFTER = `\`pnpm init:project\` is intentionally flag-driven: use
\`--mode=single --locale=<code>\` to remove locale routing.
`

const BEFORE = `API: Jest (unit) + Jest/Testcontainers (e2e). Web: Vitest for unit/component
tests, \`msw/node\` for selected same-origin \`/api/*\` integration tests,
Vitest/Testcontainers for real-Redis BFF session-vault tests
(\`pnpm --filter web test:integration\`, needs Docker, excluded from the default
\`pnpm test\`), Storybook for isolated \`shared/ui\`/feature-flow component
states plus interaction/a11y checks (\`pnpm --filter web test:storybook\`,
see [\`docs/frontend/storybook.md\`](docs/frontend/storybook.md)), Playwright
for mocked/server-mocked browser flows (\`pnpm --filter web test:e2e\`),
Playwright against the full Docker stack for auth/BFF/cookies/Redis/App Router
flows (\`pnpm --filter web test:e2e:real-stack\`), and \`@axe-core/playwright\`
for automated WCAG A/AA scans. Email templates: Vitest. Focus on critical
paths; see [\`docs/frontend/testing.md\`](docs/frontend/testing.md) for the web
taxonomy.
`

const AFTER = `API: Jest (unit) + Jest/Testcontainers (e2e). Web: Vitest for unit/component
tests, \`msw/node\` for selected same-origin \`/api/*\` integration tests,
Vitest/Testcontainers for real-Redis BFF session-vault tests
(\`pnpm --filter web test:integration\`, needs Docker, excluded from the default
\`pnpm test\`), Playwright for mocked/server-mocked browser flows
(\`pnpm --filter web test:e2e\`), Playwright against the full Docker stack for
auth/BFF/cookies/Redis/App Router flows (\`pnpm --filter web test:e2e:real-stack\`),
and \`@axe-core/playwright\` for automated WCAG A/AA scans. Email templates:
Vitest. Focus on critical paths; see
[\`docs/frontend/testing.md\`](docs/frontend/testing.md) for the web taxonomy.
`

export function buildStorybookDocsAgentsSteps(root) {
  return [
    fileStep(
      path.join(root, 'AGENTS.md'),
      (content) => {
        let next = replaceExactBlock(content, OPERATING_CONTEXT_BEFORE, OPERATING_CONTEXT_AFTER)
        next = replaceExactBlock(next, COMMANDS_NOTE_BEFORE, COMMANDS_NOTE_AFTER)
        return replaceExactBlock(next, BEFORE, AFTER)
      },
      'AGENTS.md: remove Storybook from the fork-init bullet, Commands note, and ## Testing paragraph'
    ),
  ]
}
