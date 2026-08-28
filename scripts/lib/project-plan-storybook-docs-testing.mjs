// init:project --storybook=disabled: docs/frontend/testing.md's several
// Storybook mentions — the pyramid intro, the taxonomy table row, the
// command reference rows, the "which layer" guidance bullet, and the
// "See also" bullet. Deliberately leaves two things alone: a past-tense
// PR-narrative sentence further down ("...were all green throughout")
// reporting what a specific historical real-stack E2E run actually
// covered — rewriting historical record to match a fork's current choices
// would misrepresent what happened — and the ADR-070 "See also" pointer, a
// private, maintainer-only ai/decisions/ reference that is simply absent
// (and therefore harmless) in a fork without the private ai/ repo.
import path from 'node:path'
import { fileStep, removeExactBlock, replaceExactBlock } from './init-engine.mjs'

const INTRO_BEFORE = `\`apps/web\`'s test surface (Track 7, **ADR-069**; Storybook layer added in
Track 8, **ADR-070**). The pyramid has five families — Vitest unit/component,
Vitest integration, Playwright E2E, accessibility scanning, and Storybook —
with infra integration called out separately because it has a Docker cost.
`

const INTRO_AFTER = `\`apps/web\`'s test surface (Track 7, **ADR-069**). The pyramid has four
families — Vitest unit/component, Vitest integration, Playwright E2E, and
accessibility scanning — with infra integration called out separately
because it has a Docker cost.
`

const TAXONOMY_ROW =
  '| Storybook             | `@storybook/addon-vitest` + `@storybook/addon-a11y`, browser-mode Vitest | Isolated `shared/ui`/feature-flow component states — variant/loading/error/empty/disabled — plus the same axe ruleset at component-isolation granularity | `apps/web/src/**/*.stories.tsx`, co-located; `pnpm --filter web test:storybook` |\n'

const COMMAND_ROWS =
  '| `pnpm --filter web storybook`           | Storybook component workshop dev server (`http://localhost:6006`)                            |\n' +
  '| `pnpm --filter web build-storybook`     | Static Storybook build — compile/broken-story smoke                                          |\n' +
  '| `pnpm --filter web test:storybook`      | Storybook interaction + accessibility gate (browser-mode Vitest/Playwright Chromium)         |\n'

const LAYER_GUIDANCE_BULLET = `- Adding or changing a \`shared/ui\` primitive's variant/state, or a
  feature-flow's reference composition → add or extend a **Storybook
  story** ([Storybook](./storybook.md)). Full pages, auth/BFF/session
  flows, and anything crossing \`requireSession()\` stay owned by the E2E
  lanes above — Storybook's own React Server Component support is
  experimental and deliberately not enabled here.
`

const SEE_ALSO_BULLET = `- [Storybook](./storybook.md) — the fifth pyramid layer added in Track 8:
  component-isolation states and its own accessibility gate.
`

export function buildStorybookDocsTestingSteps(root) {
  return [
    fileStep(
      path.join(root, 'docs/frontend/testing.md'),
      (content) => {
        let next = replaceExactBlock(content, INTRO_BEFORE, INTRO_AFTER)
        next = removeExactBlock(next, TAXONOMY_ROW)
        next = removeExactBlock(next, COMMAND_ROWS)
        next = removeExactBlock(next, LAYER_GUIDANCE_BULLET)
        return removeExactBlock(next, SEE_ALSO_BULLET)
      },
      'testing.md: remove every Storybook-pyramid-layer mention'
    ),
  ]
}
