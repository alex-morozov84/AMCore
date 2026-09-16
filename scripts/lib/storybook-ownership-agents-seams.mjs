import { block, seam } from './storybook-ownership-seam-helpers.mjs'

const owned = (id, selector) =>
  seam(id, 'AGENTS.md', 'owned-block', selector, ['test:storybook', 'docs/frontend/storybook.md'], {
    operationKey: 'storybook.docs-agents',
  })

export const storybookAgentsSeams = [
  owned(
    'storybook.agents-init-path',
    block(
      '   and ask the owner to initialize it. The supported fork-initialization path is',
      '   `docs/frontend/brand-theme-and-tokens.md#project-scaffolding`.',
      {
        replacement:
          '   and ask the owner to initialize it. The supported fork-initialization path is\n' +
          '   `pnpm init:brand` first, then `pnpm init:project --mode=single --locale=<code>`\n' +
          '   and/or `pnpm init:project --route-progress=disabled`, and/or\n' +
          '   `pnpm init:project --admin-console=disabled|path|host`, in any combination,\n' +
          '   only for the project choices the fork actually wants; see\n' +
          '   `docs/frontend/brand-theme-and-tokens.md#project-scaffolding`.\n',
      }
    )
  ),
  owned(
    'storybook.agents-command-note',
    block(
      '`pnpm init:project` is intentionally flag-driven: use',
      'one-time Operations Console topology choice (see `PROJECT_CONTEXT.md`).',
      {
        replacement:
          '`pnpm init:project` is intentionally flag-driven: use\n' +
          '`--mode=single --locale=<code>` to remove locale routing, and/or\n' +
          "`--route-progress=disabled` to turn off the top route-progress bar's\n" +
          'default (non-destructive), and/or `--admin-console=disabled|path|host` for the\n' +
          'one-time Operations Console topology choice (see `PROJECT_CONTEXT.md`).\n',
      }
    )
  ),
  owned(
    'storybook.agents-testing',
    block('API: Jest (unit) + Jest/Testcontainers (e2e). Shared: Vitest for', 'taxonomy.', {
      replacement:
        'API: Jest (unit) + Jest/Testcontainers (e2e). Shared: Vitest for\n' +
        "`packages/shared`'s own schema/lib unit tests (`pnpm --filter shared test`,\n" +
        'included in the default `pnpm test`). Web: Vitest for unit/component\n' +
        'tests, `msw/node` for selected same-origin `/api/*` integration tests,\n' +
        'Vitest/Testcontainers for real-Redis BFF session-vault tests\n' +
        '(`pnpm --filter web test:integration`, needs Docker, excluded from the default\n' +
        '`pnpm test`), Playwright for mocked/server-mocked browser flows\n' +
        '(`pnpm --filter web test:e2e`), Playwright against the full Docker stack for\n' +
        'auth/BFF/cookies/Redis/App Router flows (`pnpm --filter web test:e2e:real-stack`),\n' +
        'and `@axe-core/playwright` for automated WCAG A/AA scans. Email templates:\n' +
        'Vitest. Focus on critical paths; see\n' +
        '[`docs/frontend/testing.md`](docs/frontend/testing.md) for the web taxonomy.\n',
    })
  ),
]
