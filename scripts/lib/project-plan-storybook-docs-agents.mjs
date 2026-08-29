// init:project --storybook=disabled: AGENTS.md's "## Testing" paragraph.
import path from 'node:path'
import { fileStep, replaceExactBlock } from './init-engine.mjs'

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
      (content) => replaceExactBlock(content, BEFORE, AFTER),
      'AGENTS.md: remove Storybook from the ## Testing paragraph'
    ),
  ]
}
