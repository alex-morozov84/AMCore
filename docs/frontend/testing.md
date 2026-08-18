# Frontend Testing

`apps/web`'s test surface (Track 7, **ADR-069**; Storybook layer added in
Track 8, **ADR-070**). The pyramid has five families — Vitest unit/component,
Vitest integration, Playwright E2E, accessibility scanning, and Storybook —
with infra integration called out separately because it has a Docker cost.
This guide says which layer a new test belongs in and why, not just how to
run the suite.

## The taxonomy

| Layer                 | Tool                                                                     | Boundary it proves                                                                                                                                       | Where                                                                           |
| --------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Unit / component      | Vitest + `jsdom`, `vi.mock`/`vi.stubGlobal('fetch')`                     | Isolated logic, rendered components with mocked collaborators                                                                                            | `apps/web/src/**/*.test.{ts,tsx}`, co-located                                   |
| Integration           | Vitest + `jsdom` + `msw/node`'s `setupServer()`                          | The real same-origin `/api/*` request contract (URL, method, query params, error shape)                                                                  | co-located, e.g. `*.msw-integration.test.tsx`                                   |
| Infra integration     | Vitest + Testcontainers, real Redis                                      | The BFF session vault's Lua CAS scripts and locking, unreachable by a mocked client                                                                      | `apps/web/src/**/*.integration.test.ts`, `pnpm --filter web test:integration`   |
| E2E — mocked lane     | Playwright, `next dev`, no real backend                                  | Browser-originating requests (`page.route()`) and server-side BFF boundaries (Next's `testProxy`/MSW fixture) — no real Postgres/Redis/`apps/api`        | `apps/web/e2e/mocked/`, `apps/web/e2e/server-mocked/`                           |
| E2E — real-stack lane | Playwright, `docker-compose.yml`'s `local-infra` profile                 | Auth/BFF/cookies/Redis/App Router end to end — the only lane that proves this                                                                            | `apps/web/e2e/real-stack/`                                                      |
| Accessibility         | `@axe-core/playwright`, riding on the E2E layers above                   | WCAG A/AA structural/semantic rules on a fully-rendered page                                                                                             | `apps/web/e2e/shared/axe.ts` helper, used from either E2E lane                  |
| Storybook             | `@storybook/addon-vitest` + `@storybook/addon-a11y`, browser-mode Vitest | Isolated `shared/ui`/feature-flow component states — variant/loading/error/empty/disabled — plus the same axe ruleset at component-isolation granularity | `apps/web/src/**/*.stories.tsx`, co-located; `pnpm --filter web test:storybook` |

No global coverage percentage gate. Confidence comes from the critical-path
flow lists below being real and current, not a line-coverage number —
matches `ai/TESTING.md`'s "confidence over coverage" philosophy for the
backend suite.

## Unit and component tests

Unchanged, already the largest layer (55+ files). Two established mocking
shapes, kept side by side rather than merged:

- **Hook/query tests** mock the typed client module:
  `vi.mock('@/shared/api', () => ({ authApi: { ... } }))`.
- **BFF Route Handler / DAL tests** stub the global `fetch`:
  `vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(...)))`.

Both are fast and fine for logic/branch coverage — but neither ever looks
at the actual outgoing request, which is exactly the gap the next layer
closes.

## Integration tests — the real `/api/*` wire contract

`msw/node`'s `setupServer()`, not `msw/browser`'s `setupWorker()`:
`jsdom` has no real Service Worker to register, and `setupServer()` patches
the network client directly — works identically regardless of environment.
Scoped **per test file** (`beforeAll`/`afterEach`/`afterAll` local to that
file), not wired into the global Vitest setup, so it never affects the
unit-test files above.

```ts
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

it('sends page/limit as real query string params', async () => {
  let capturedUrl: URL | undefined
  server.use(
    http.get('/api/auth/sessions', ({ request }) => {
      capturedUrl = new URL(request.url)
      return HttpResponse.json({ data: [], total: 0, page: 3, limit: 5 })
    })
  )
  const { result } = renderHook(() => useSessions(3, 5), { wrapper })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(capturedUrl?.searchParams.get('limit')).toBe('5') // a vi.mock test never sees this
})
```

Use this layer when a hook/component's behavior depends on what actually
gets sent or on how a non-2xx response is handled — not for every hook;
`vi.mock` unit tests stay the default for pure branch logic.

## Infra integration — real Redis

`pnpm --filter web test:integration` runs Vitest against Testcontainers-backed
Redis. This layer is intentionally narrow: use it when the behavior depends on
Redis semantics a fake cannot prove, such as the BFF session vault's Lua CAS
scripts, locks, TTLs, or atomic multi-step updates. It is excluded from the
default `pnpm test` and needs Docker.

Do not move browser flows here. If the risk is “does a real user session,
cookie, Server Component, and backend work together”, use the real-stack
Playwright lane instead.

## E2E — three projects, two runtime targets

`page.route()` only intercepts **browser-originating** requests — it cannot
fake a server-side `requireSession()`/Redis read a Server Component or
Route Handler makes before the browser ever sees a response. That's the
actual line the E2E split is drawn on, not an arbitrary cost/confidence
tradeoff. In code this is three Playwright projects (`mocked`,
`server-mocked`, `real-stack`), grouped under two runtime targets:
infra-free `next dev`, and the full Docker stack.

### Mocked lane (`apps/web/e2e/mocked/`, `.../server-mocked/`)

No real Postgres/Redis/`apps/api`. `page.route()` for anything
browser-originating; Next's own `experimental/testmode/playwright/msw`
fixture (`next/experimental/testmode/playwright/msw`, gated behind
`experimental.testProxy` in `next.config.ts` — itself gated behind
`PLAYWRIGHT_TEST_PROXY`, which only `playwright.config.ts`'s
`webServer.env` sets, never a real dev/prod boot) for server-side fetches
`page.route()` can't reach.

Current flows: locale redirect, login/register client-side validation
(no network call reaches the BFF), a mocked API failure rendering the
localized `ApiErrorAlert` fallback, stored-theme persistence/no-flash, and
the OAuth entry-point's visibility (shown/hidden based on a mocked
`apps/api` response).

```bash
pnpm --filter @amcore/shared build    # needed on a clean checkout before direct Playwright runs
pnpm --filter web test:e2e            # runs both "mocked" and "server-mocked" projects
```

### Real-stack lane (`apps/web/e2e/real-stack/`)

Targets `docker-compose.yml`'s `local-infra` profile (real Postgres, Redis,
standalone `apps/web`, real `apps/api`) booted **externally** — a separate
`playwright.real-stack.config.ts` with no `webServer` of its own, so it
never tries to start or reuse-detect against the unrelated `next dev`
server the mocked lane uses.

```bash
pnpm --filter @amcore/shared build
docker compose --profile local-infra up -d --build
pnpm --filter web test:e2e:real-stack
docker compose down -v
```

Current flows: register → authenticated landing → logout; login with real
credentials; active sessions list/revoke (no revoke control on the current
session); a locale switch persisting to a **fresh session** via
`PATCH /auth/me` (proven by waiting for that specific response, not racing
the client-side navigation against it); and the `requireSession()` redirect
gate on two protected routes.

**Not automated yet, named rather than silently skipped:** a BFF SSE smoke
test. Track 6 proved `EventSource` survives the standalone proxy manually;
automating a real Redis Pub/Sub publish + browser receive in E2E is a
real harness cost, deferred to a later slice.

Async Server Components are why the real-stack lane exists at all, not
just a preference: Next's own bundled Vitest guide
(`node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`) states
Vitest does not support testing `async` Server Components — exactly the
shape of `requireSession()`-gated pages and BFF DAL reads — and recommends
E2E for them.

## Accessibility

`@axe-core/playwright` — the only actively-maintained option; `jest-axe`
and `vitest-axe` both wrap the same `axe-core` engine but neither wrapper
is actively developed. Rides on the E2E layers above (near-zero marginal
cost once a page is already visited), not a separate tool/dependency.

```ts
import { expectNoAxeViolations } from '../shared/axe'

test('login page has no axe violations', async ({ page }) => {
  await page.goto('/en/login')
  await expectNoAxeViolations(page)
})
```

WCAG A/AA tags through 2.2 (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`,
`wcag22aa` — confirmed present in the installed `axe-core` version before
being added; don't assume a tag exists, check `axe-core`'s bundled tag
list). Scanned today: login (default + API-error state), register, the
authenticated dashboard, and the sessions page including with the
row-actions dropdown open.

**Popups need a settled-animation check before scanning.** A dropdown/
dialog fading/zooming in over a CSS entrance animation can make axe sample
a partially-transparent frame and report a false `color-contrast`
violation — confirmed live via `getComputedStyle` on the settled element
before concluding either way. Use `waitForAnimationsToFinish()` (polls the
Web Animations API, not a fixed sleep) after opening a popup and before
scanning it:

```ts
await page.getByRole('button', { name: /actions/i }).click()
await waitForAnimationsToFinish(page, '[data-slot="dropdown-menu-content"]')
await expectNoAxeViolations(page)
```

**This is partial WCAG coverage, not a compliance pass.** Automated
scanning is well-documented as catching roughly half of real issues
(contrast, missing labels, landmark/ARIA misuse — not things like "does
this make sense read aloud" or a keyboard trap a scanner can't judge).
Complements, does not replace, the static token-contrast-pair suite in
`shared/lib/theme.test.ts`; a manual pass is still worth doing before
calling a surface WCAG-reviewed.

## Dev workflow: verifying a change at runtime

Two views, framework-neutral wording deliberately — this repo doesn't
require one specific agent's browser-automation tool:

1. **The framework's view** — Next's built-in MCP server at `/_next/mcp`,
   which can be bridged through `next-devtools-mcp` in an agent/workspace MCP
   config when that environment provides one. `get_compilation_issues`/
   `compile_route` report whether a route compiles; `get_errors` reports
   client-side and config errors once a browser session is connected —
   **it does not surface server-side Route Handler errors**; use `get_logs`
   (points at the real dev log file) for those.
2. **The browser's view** — whatever browser automation is available in
   your agent environment (navigate, read console/network, read the DOM/
   accessibility tree).

Check compilation/errors first, then drive the page and assert the
intended behavior — the same four-question loop as Next's own
`next-dev-loop` skill (compiles? no server errors? correct in the browser?
does framework-internal state make sense?), without requiring the specific
tool that skill's published form hard-depends on. `ai/CLAUDE.md` documents
an optional, maintainer-installable tool with additional React-internals
capabilities (component-tree inspection, Suspense-boundary analysis) for
sessions that need it — not named here because it's tied to one agent
environment, not a portable requirement for every fork.

## Commands

| Command                                 | What it runs                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm --filter web test`                | Unit + component + integration tests (watch mode)                                            |
| `pnpm --filter web test:run`            | Same, single run                                                                             |
| `pnpm --filter web test:coverage`       | Same, with a coverage report (informational, no gate)                                        |
| `pnpm --filter web test:integration`    | Testcontainers-backed real-Redis tests (needs Docker)                                        |
| `pnpm --filter web test:e2e`            | Playwright mocked + server-mocked lanes (auto-starts `next dev`)                             |
| `pnpm --filter web test:e2e:real-stack` | Playwright real-stack lane — boot `docker compose --profile local-infra up -d --build` first |

On a clean checkout, run `pnpm --filter @amcore/shared build` before either
Playwright command. `apps/web` imports `@amcore/shared` through its built
`dist/` export, and direct Playwright commands bypass turbo's `^build`
dependency graph. The CI `web-e2e` job has this as an explicit step.

## Which layer should I add a test at?

- Pure logic, a component with mocked collaborators → **unit/component**.
- A hook/Route Handler's request shape (URL, params, headers, error
  handling) matters and a `vi.mock` wouldn't actually check it →
  **integration** (`msw/node`).
- A behavior only exists client-side, doesn't need a real session, and
  doesn't cross a server-side data read → **mocked E2E lane**
  (`page.route()`, or the `testProxy`/MSW fixture if the boundary is
  server-side).
- The behavior involves `requireSession()`, cookies, Redis, or an
  `async` Server Component → **real-stack E2E lane** — nothing else can
  prove it.
- Adding or touching a page/component with visible copy or a popup →
  add or extend an axe scan on the E2E layer that already visits it.
- Adding or changing a `shared/ui` primitive's variant/state, or a
  feature-flow's reference composition → add or extend a **Storybook
  story** ([Storybook](./storybook.md)). Full pages, auth/BFF/session
  flows, and anything crossing `requireSession()` stay owned by the E2E
  lanes above — Storybook's own React Server Component support is
  experimental and deliberately not enabled here.

## See also

- [Architecture & conventions](./architecture-and-conventions.md) — FSD
  layers, route thinness, and the BFF Route Handler layer these tests
  exercise.
- [API consumption](./api-consumption.md) — the hooks the integration
  layer's contract tests target.
- [Storybook](./storybook.md) — the fifth pyramid layer added in Track 8:
  component-isolation states and its own accessibility gate.
- **ADR-069** (`ai/decisions/adr-069-frontend-testing-pyramid.md`) — the
  full decision record: every mechanism choice, the two pre-implementation
  spikes, and why each was made.
- **ADR-070** (`ai/decisions/adr-070-storybook-component-workshop.md`) —
  the Storybook layer's own decision record.
- `ai/TESTING.md` — the maintainer-facing mirror of this guide, alongside
  the backend/email testing conventions.
