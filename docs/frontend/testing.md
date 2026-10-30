# Frontend Testing

Choose the test layer that proves the changed behavior: unit/component,
integration, browser E2E, accessibility or Storybook. Infrastructure integration
uses a separate command because it needs Docker.

## Production typechecking

Next uses `tsconfig.build.json` in development, type generation and production builds.
Restart a running development server after changing that config selection. Application
source, declarations, `next.config.ts` and generated route types remain checked.
Tests, stories, browser fixtures and test configuration are outside the production roots.

From the repository root, build shared prerequisites and regenerate route declarations:

```bash
pnpm --filter @amcore/shared build
pnpm --filter web exec next typegen
pnpm --filter web typecheck
pnpm --filter web typecheck:build
```

Type generation loads `next.config.ts` in production mode. Supply the documented project
configuration first. Use the supported Node/pnpm versions and browser prerequisites from
[Quick Start](../../README.md#quick-start) and [managed stands](../operations/local-stands.md#prerequisites-and-commands).
If generated declarations describe removed routes, stop only your development server,
regenerate current production types, and inspect remaining `.next/dev/types` diagnostics.
Remove stale generated output only in your own inactive checkout; never delete a live
server's lock or another task's output. A clean managed stand supplies isolated output.

Run `pnpm --filter web typecheck` for the complete source/test/configuration check.
`pnpm --filter web typecheck:build` checks the smaller production config independently.
Both commands remain strict. Excluded files can reenter through imports.

Next additionally filters `.next/dev/types` roots during production typechecking.
The standalone command retains those roots, and imports can reintroduce them into Next.
Next also filters test-file diagnostics; the complete standalone typecheck does not.
Keep these memberships and diagnostics distinct when investigating different results.
The independent build command stores its incremental state in
`.amcore/typescript/build.tsbuildinfo`; Next manages its own build cache.

The version-scoped [Next route-cache patch](next-route-cache-patch.md) needs a production
browser regression. A successful development run cannot prove its cache behavior.

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
flow lists below being real and current, not a line-coverage number — the
same "confidence over coverage" philosophy the backend test suite follows.

## Lint contract fixtures

Lint contract tests use `createLintFixture()` from `scripts/lib/lint-fixture.mjs`.
Create one disposable working-tree copy per test file and register its cleanup.
The copy links installed dependencies and runs the real paired lint wrapper with
unchanged relative paths and policy. It never installs dependencies.
Keep temporary TypeScript probes outside the live checkout: parallel source
inventory guards can otherwise enumerate a probe just before its owner deletes it.
Source guards keep their complete inventory and fail on unreadable source files.

## Production deployment version recovery

From the repository root, with dependencies and Playwright Chromium installed:

```bash
node scripts/run-deployment-version-e2e.mjs
```

This separate, infrastructure-free production lane builds A and B sequentially
in temporary copies, adds different real Server Actions and a custom 500 ms
client timer that swallows failures, then switches one isolated proxy between
standalone builds. It never adds fixture routes to your checkout. Builds and
assertions are visible in the terminal; allow several minutes. Ports 3420–3422
must be free; set `VERSION_E2E_PORT` to choose another consecutive trio. Servers
and temporary copies are removed on normal completion or test failure.

The gate checks A→B without/with a service worker, rollback B→A, repeated deploy,
≤100 obsolete POST per transition, zero obsolete POST during the following
minute, one document replacement, two-minute idle GET budget, invalid/503/stale/
timed-out signals and recovery, stale HTML/manual refresh and the replacement
cap. The timer uses neither a polling helper nor Action preflight. Unit tests
cover request coalescing, cleanup and session guards separately.

This lane does not prove a genuinely frozen/background browser or full-stack
BFF authentication. Test real browser suspension and your CDN/custom worker on
the deployment target; use the real-stack lane below for auth/session flows.
The bundled worker caches only install icons; it must not serve old HTML, RSC,
API/version responses or chunks as an offline application. See the
[deployment contract](../operations/deployment.md#open-tabs-after-a-web-deployment).

## Complete CI E2E locally

Install frozen dependencies and Playwright Chromium, then run from the repository root:

```bash
node scripts/e2e-ci.mjs --all
```

This invokes the same lane commands as GitHub with `CI=true`: forbidden `.only`,
one browser worker per stand and one retry. Locally the lanes run sequentially
on one machine; GitHub runs each lane on a separate Ubuntu runner. This proves
matching commands, inventory and settings, not identical OS, hardware or cache timings.
A nonzero, cancelled or missing lane cannot produce a successful aggregate result.
Mocked completion waits up to ten seconds for short-lived source processes to
exit naturally before verified closeout. A remaining process or unavailable
ownership inventory fails the lane and retains recovery; unproved children are
never killed to make the check pass.

The lanes are safety/transport, both mocked projects, ordinary path-mode tests,
disruptive path-mode tests (entire runtime-settings/background-work files), and
HTTPS host tests when the Console is retained. Every Docker lane owns fresh
Postgres, Redis, origins, volumes, lease, marker and cleanup. Keep `workers: 1`:
Redis pauses, runtime-setting revisions and registration IP budgets are shared
within a stand. Unique emails do not isolate those mechanisms.
Domain fixtures reset only their known MFA source and browser-probe IP budgets
on the leased disposable stand before an independent journey. Limiter tests do
not use these resets. Domain success is not a production capacity measurement.

Run one lane with `node scripts/e2e-ci.mjs path-standard` (also `safety`, `mocked`,
`path-disruptive` and `host` when applicable). New ordinary specs automatically join
`path-standard`; runtime-settings/background-work specs join `path-disruptive`.
Product-administration specs use declared fixture groups from
`scripts/product-admin-e2e-plan.mjs`. The required Web E2E aggregate includes
`staff-oauth` and the applicable retained integration profiles. Each spec belongs
to one profile; missing declared files fail inventory checks. Signed path OAuth
uses its dedicated fixture, outside ordinary path groups. These fixtures prove
application transport and verified identity handling, not live provider registration.

The separate `setup-cli` lane proves closed-registration installation with the
compiled command and an actual captured recovery email. It always applies.
<!-- AMCORE_CONSOLE_ESTABLISHMENT_TESTING_START -->

`setup-console` adds the same initial lifecycle through the retained HTTPS Console.
<!-- AMCORE_CONSOLE_ESTABLISHMENT_TESTING_END -->

Both use fresh `organization-setup` fixtures. Ordinary registration-dependent tests
remain in their original stands. See [initial installation proof](../operations/local-stands.md#initial-organization-installation-proof)
for scoped commands and the internal-only mailbox boundaries.
Before grouped execution, the runner collects Playwright's full and selected
inventories, rejects missing/duplicate tests and writes `inventory.json` under
that stand. Full original `pnpm stand e2e --lane real-stack` remains available.
Successful and failed GitHub lanes retain reports/test results/inventories for
seven days; inspect retries separately from clean passes. The unchanged mandatory
`Web E2E` result requires every applicable lane to succeed.

## Stable accessibility scans

Use `expectNoAxeViolations(page)` from `e2e/shared/axe.ts`. It waits for loaded
fonts, resolves layout and observes finite animations/transitions throughout the
page before running axe once. Nested fades and theme colour transitions are
included; infinite spinners continue and cannot block this wait. A finite paused
or stuck transition fails within ten seconds rather than being silently cancelled.
The helper changes no styles, theme, reduced-motion setting or axe rules.
The scan also waits, for up to ten seconds, until no visible region is `aria-busy="true"`: a pending
control can sit in a stable half-transparent state that animation settling cannot see, and scanning it
reports a contrast failure the person never sees. A region that never finishes loading fails with a
message saying so. A test whose subject is the busy state itself passes `{ allowBusy: true }`. The same
rule applies to counting requests: take the baseline only once the previous step is idle, and compare
request lists with `expect.poll` rather than sampling once.
For a deliberately scoped scan use `scanAccessibility(page, { include, rules })`
from the same module and retain assertions on both violations and scanned nodes.

Assert the intended UI state first (for example a loaded view or an open dialog).
Visual stability does not prove hydration, completed data loading or authority.
Do not scan a skeleton when the scenario is meant to prove the loaded form.
Keep normal-motion and reduced-motion behavior checks in their own scenarios.
Oxlint rejects direct runtime imports of axe in E2E outside the shared helper,
with guidance to use it. Genuine final-state contrast violations remain failures;
never fix transient results by excluding nodes, disabling contrast or retrying
scans until one passes. Screenshot `animations: 'disabled'` does not configure axe.

The browser regression covers nested/ancestor finite fades, continuing infinite
motion and a deliberately bad final contrast that must still fail. This follows
[Playwright's instruction to reach the intended state before scanning](https://playwright.dev/docs/accessibility-testing).

## Application alert selectors

Next.js also renders a `role="alert"` route-announcer live region. Browser tests
must distinguish it from the application's error message. Use
`page.locator('[data-slot="alert"][role="alert"]')` for the shared Alert, or scope
the query to the relevant component. Keep assertions for the expected message
and for absence of private diagnostics; do not resolve ambiguity with `.first()`.

`pnpm --filter web lint` rejects direct `page.getByRole('alert')` calls without
options and direct `page.locator()` calls with the bare literal selectors
`[role="alert"]`, `[role='alert']` or `[role=alert]` in every `e2e/` lane.
The guard runs without Docker or a browser. It is a targeted syntax check, not
proof that every selector is unique: aliases, computed selectors and options
still require review and browser verification.

## Unit and component tests

Use the mocking pattern that matches the boundary under test:

- **Hook/query tests** mock the typed client module:
  `vi.mock('@/shared/api', () => ({ authApi: { ... } }))`.
- **BFF Route Handler / DAL tests** stub the global `fetch`:
  `vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(...)))`.

Both are fast and fine for logic/branch coverage — but neither ever looks
at the actual outgoing request, which is exactly the gap the next layer
closes.

A `catchError` (`next/error`) boundary's actual catch-and-fallback behavior
is a third gap this layer can't close: its real implementation reaches
into Next's app-router client runtime, which plain Vitest + Testing Library
does not initialize. Test that nothing throws
in the healthy case here; prove the thrown-child → fallback → `retry()`
path in Storybook instead (`@storybook/nextjs-vite`'s
`parameters.nextjs.appDirectory` mock supplies the context) — see
`shared/ui/section-error-boundary.test.tsx` /
`.stories.tsx` for the split in practice, and
[Server-rendered graceful degradation](./server-rendered-resilience.md) for
the pattern this boundary is part of.

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

Public-auth scenarios import `test` from `e2e/shared/auth-test.ts`. Its auto fixture
returns an explicit enabled public signup policy through the server-side proxy;
a browser `page.route()` cannot supply that SSR policy. Scenarios testing closed
or unavailable signup must override that endpoint with their intended response.

Current flows: locale redirect, login/register client-side validation
(no network call reaches the BFF), a mocked API failure rendering the
localized `ApiErrorAlert` fallback, stored-theme persistence/no-flash, the
OAuth entry-point's visibility (shown/hidden based on a mocked `apps/api`
response), and the top route-progress bar's full lifecycle — a real
`<Link>` click, a programmatic navigation, browser Back, a fast/already-resolved
navigation, a modifier-click exclusion, and reduced motion (see
[Top route progress bar](./route-progress.md)).

```bash
pnpm --filter web test:e2e # both mocked projects; no Docker
```

Managed startup isolates source/env/output and never reuses another checkout.
See [local stands](../operations/local-stands.md) for targeting and recovery.

### Real-stack lane (`apps/web/e2e/real-stack/`)

The managed runner provisions fresh Docker Postgres/Redis/API/web, migrates and
seeds its own database, then runs Playwright and scoped cleanup:

```bash
pnpm stand e2e --lane real-stack
```

Current flows: register → authenticated landing → logout; login with real
credentials; forgot-password, reset-password, verify-email, and
resend-verification public-auth actions against the real BFF/backend error
contract; active sessions list/revoke (no revoke control on the current
session); a locale switch persisting to a **fresh session** via
`PATCH /auth/me` (proven by waiting for that specific response, not racing
the client-side navigation against it); the `requireSession()` redirect
gate on two protected routes; and the dashboard app shell — the mobile
(`375px`) Sheet variant and the sidebar's collapsed state surviving a
reload through the `sidebar_state` cookie.

The sidebar cookie is written by the client and read by a server layout.
Use real-stack E2E to prove that complete path. A unit test of either side alone
cannot establish cookie persistence across a reload.

BFF SSE delivery has no automated browser smoke test. Do not claim browser
Pub/Sub coverage from the existing real-stack lane.

Use real-stack E2E for `requireSession()`, cookies, Redis and request-bound
Server Component behavior. Next's bundled Vitest guide
(`node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`) recommends E2E
for async Server Components because Vitest cannot render them directly.

A narrow unit-test case can render already-resolved output:

```tsx
render(await OverviewPage())
```

Use this only when all server collaborators are mocked and every returned child
is synchronous. It tests conditional composition over the mocked result. It does
not prove auth/BFF behavior or provide general async-component support. A child
with its own real asynchronous work belongs in E2E; do not restructure production
components solely to make this unit-test technique apply.

## Accessibility

Keep `axe-core` and `@axe-core/playwright` on the same resolved engine version.
The unit contract `src/test/axe-version-contract.test.ts` checks the direct and
Playwright resolutions; updating only one package can leave browser checks
enforcing different rules.

For a text link or button, its accessible name must contain its visible text.
Prefer the visible text as the name; when extra context is needed, retain that
text in the name. Test translated names in component tests, and provide a
browser component state with the actual links/actions rendered. Static JSX lint cannot
evaluate all translated or dynamically composed names.

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

The shared helper checks WCAG A/AA tags through 2.2: `wcag2a`, `wcag2aa`,
`wcag21a`, `wcag21aa` and `wcag22aa`. Check installed axe tag support when changing
this set.

For a popup, assert its intended open state and call the same helper:

```ts
await page.getByRole('button', { name: /actions/i }).click()
await expect(page.getByRole('menu')).toBeVisible()
await expectNoAxeViolations(page)
```

The helper already waits for visual stability. Follow
[Stable accessibility scans](#stable-accessibility-scans); do not add a second
animation wait just for axe. Explicit settled-state assertions may still use
`waitForAnimationsToFinish()` from the same shared module.

**Session scans distinguish readiness from retained content.** For a settled
scan, first assert the expected rows/current-session badge, `aria-busy="false"`
and the relevant enabled controls. The Sessions-local
`waitForSessionTransitions()` observes finite animations on the tested surface
and its descendants; it excludes infinite animations such as a refresh
spinner. Waiting for a spinner to stop is not a valid pending-state
check.

The real-stack retained-refetch regressions hold an actual authenticated list
response without changing its data. Before releasing it, they assert preserved
row content and counts, `aria-busy="true"` and the existing control feedback,
then call `expectNoAxeViolations(page, { allowBusy: true })` while the response
is still held. After release,
they assert the settled content and scan again. Settings covers both themes. Release and join held
requests, unregister handlers and close additional contexts in `finally`.
Auth, cookies and persistence remain real in this lane.

Run the scoped regressions through the same managed target:

```bash
pnpm stand e2e --lane real-stack -- sessions-readability.spec.ts
```

See [local stands](../operations/local-stands.md); arbitrary baseURL/Compose
selector overrides are no longer supported by low-level real-stack helpers.

When the optional Console is enabled, its retained-refetch tests cover desktop
and mobile in both themes, with the existing refresh spinner and control guards.
They also check the actual initials on the composited header background:

```bash
pnpm stand e2e --lane real-stack -- admin-sessions/readability.spec.ts
```

Use the same isolated-stack configuration for these Console checks.

**This is partial WCAG coverage, not a compliance pass.** Automated
scanning is well-documented as catching roughly half of real issues
(contrast, missing labels, landmark/ARIA misuse — not things like "does
this make sense read aloud" or a keyboard trap a scanner can't judge).
Complements, does not replace, the static token-contrast-pair suite in
`shared/lib/theme.test.ts`; a manual pass is still worth doing before
calling a surface WCAG-reviewed.

## CSP and security headers

Static headers (`Referrer-Policy`, `X-Content-Type-Options`,
`Permissions-Policy`, `X-Frame-Options`, HSTS) and the CSP nonce mechanism
are both environment-independent — deterministic regardless of dev vs.
production — so the `mocked` lane can assert them directly against `next
dev`'s real HTTP responses, fetched via Playwright's `request` fixture
rather than `page.content()` (browsers deliberately zero out a rendered
element's `nonce` attribute once it's in the document, a defense against
reading it back via `innerHTML`/XSS — `page.content()` always reports
`nonce=""` regardless of what the server actually sent).

**"Zero CSP violations during normal navigation" is a real-stack-only
assertion.** `next dev`'s own Turbopack HMR machinery injects dozens of
inline `<style>` tags for its own tooling — a real, observed
`style-src-elem` violation storm that is 100% dev-tooling noise, absent
from the production build. Asserting "zero violations" against `next dev`
is a false negative either way: noisy-red on a correct policy, or silently
passing if loosened to tolerate it, hiding a real future regression.
`e2e/real-stack/csp-nonce.spec.ts` runs this check against the actual
standalone/Docker build instead — the artefact that ships.

**Proving a CSP guard can fail, not just that it's present**, needs a real
HTML-parsed injection, not `page.evaluate()`: Chrome's DevTools Protocol
execution is exempt from CSP entirely (a real, documented Chromium
behavior), so injecting a probe script via `page.evaluate()` +
`appendChild` proves nothing either way. Use `page.route()` to modify the
_served response body_ instead — real content the browser actually parses:

```ts
await page.route('**/en/login', async (route) => {
  const response = await route.fetch()
  const body = await response.text()
  const injected = body.replace('</body>', '<script>window.__probe = true</script></body>')
  await route.fulfill({ response, body: injected })
})
```

See `e2e/mocked/csp-nonce.spec.ts` and `e2e/real-stack/csp-nonce.spec.ts`
for the full pattern (nonce-matching assertions, hostile-inbound-header
regression coverage, the injection proof above) and
[Browser security headers and CSP](./browser-security-and-csp.md) for the
policy itself.

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
tool that skill's published form hard-depends on. Some maintainer sessions
additionally install a tool with extra React-internals capabilities
(component-tree inspection, Suspense-boundary analysis) — not named here
because it's tied to one agent environment, not a portable requirement for
every fork.

### Observable long-running checks

Long-running checks need an observable lifecycle, particularly Docker-backed
builds and E2E tests. If the terminal integration offers a persistent
terminal/PTY session, start the command in that session, retain its handle,
and poll the live output until an exit status is returned. This preserves the
current phase (build, health checks, test execution, cleanup) and detects a
real hang.

Do not background a verification command or redirect its output to a file just
to work around an agent/tool timeout. Those approaches obscure its state, and
an outer transport timeout can terminate the parent process while the runner's
cleanup executes. That is **transport interrupted — no verdict**, not a pass or
failure. Confirm that the owning process stopped and managed cleanup finished
before starting a fresh observable run.

`pnpm test:console-session-e2e` is the reference case: it builds an isolated
Compose stack, waits for it to become healthy, runs Playwright against the
HTTPS console host, and tears the stack down in `finally`. Run it as a single
foreground command and observe all four phases; do not manually start a second
copy while its cleanup is still removing containers, networks, and volumes.

In an agent environment with a process sandbox, run `pnpm --filter web build`
with the required user-approved escalation. A sandbox hang, a `.next` lock
conflict, or a transport interruption is **not** a production-build verdict.
The escalated build must still use the observable foreground/PTY workflow
above. This prevents a constrained execution environment from being confused
with an application failure.

### Verification plan, not retries

Before running a suite, write down which changed risk it proves and choose the
smallest appropriate layer from [Which layer should I add a test at?](#which-layer-should-i-add-a-test-at).
Run cheap static/unit checks first. Run a Docker-backed or full-browser check
once per unchanged review iteration, only after the code it covers is settled;
a passing result remains valid until that behavior changes. This review-time
execution discipline does not waive repository-required final-delivery or CI
gates: run those at the workflow stage that owns them even when an earlier
targeted check passed. Do not restart a broad suite after a sandbox, lock, or
transport failure — it has no verdict. Diagnose and repair the failed
prerequisite, then make one observable run of the affected check.

## Commands

| Command                                 | What it runs                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm --filter web test`                | Unit + component + integration tests (watch mode)                                    |
| `pnpm --filter web test:run`            | Same, single run                                                                     |
| `pnpm --filter web test:coverage`       | Unit-project run with a V8 coverage report (informational, no gate)                  |
| `pnpm --filter web test:integration`    | Testcontainers-backed real-Redis tests (needs Docker)                                |
| `pnpm --filter web storybook`           | Storybook component workshop dev server (`http://localhost:6006`)                    |
| `pnpm --filter web build-storybook`     | Static Storybook build — compile/broken-story smoke                                  |
| `pnpm --filter web test:storybook`      | Storybook interaction + accessibility gate (browser-mode Vitest/Playwright Chromium) |
| `pnpm --filter web test:e2e`            | Playwright mocked + server-mocked lanes (auto-starts `next dev`)                     |
| `pnpm --filter web test:e2e:real-stack` | Playwright real-stack lane — managed isolated Docker startup and cleanup             |
| `pnpm test:console-session-e2e`         | Isolated Compose + Playwright console HTTPS/cookie/Redis audience lane               |

On a clean checkout, run `pnpm --filter @amcore/shared build` before the
direct web coverage command so Vitest can resolve the shared package. The
coverage run prints a summary of statements, branches, functions and lines;
open `apps/web/coverage/index.html` for file-level detail or read
`apps/web/coverage/coverage-final.json` with a tool. These reports are
informational: no percentage threshold determines whether the command passes.

The Playwright commands above prepare their own isolated runtime; see
[local stands](../operations/local-stands.md) for prerequisites and lifecycle.

## Credential containment regression

`e2e/real-stack/credential-containment.spec.ts` runs in the normal real-stack
lane and CI. It needs no local harness files and has no skip for unavailable
infrastructure: configuration or connection errors fail the test. It covers
safe UI register/login, JWT-route denial, method ownership, raw path variants,
internal refresh and direct API organization switching.

The managed runner seeds its own fresh test database before organization creation.
Production migrations remain seed-free. Run a scoped check with:

```bash
pnpm stand e2e --lane real-stack -- credential-containment.spec.ts
```

Web/API/SQL/Redis helpers derive one admitted target from the active run manifest;
there are no independent endpoint overrides. See
[local stands](../operations/local-stands.md) for lifetime and transport.

## Which layer should I add a test at?

- Pure logic, a component with mocked collaborators → **unit/component**.
- A hook/Route Handler's request shape (URL, params, headers, error
  handling) matters and a `vi.mock` wouldn't actually check it →
  **integration** (`msw/node`).
- A behavior only exists client-side, doesn't need a real session, and
  doesn't cross a server-side data read → **mocked E2E lane**
  (`page.route()`, or the `testProxy`/MSW fixture if the boundary is
  server-side).
- The behavior involves `requireSession()`, cookies, Redis, or genuine
  per-request server context → **real-stack E2E lane** — nothing else can
  prove it. Pure conditional branching inside an `async` page over an
  already-mocked `DataOutcome`, with every nested component flattened to
  synchronous, may instead use the narrow `render(await Page())` unit-test
  exception described above — it is not a substitute for the real-stack
  lane whenever session/cookie/Redis/request behavior is what's actually
  under test.
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
- [Browser security headers and CSP](./browser-security-and-csp.md) — the
  policy the "CSP and security headers" section above tests.
- [API consumption](./api-consumption.md) — the hooks the integration
  layer's contract tests target.
- [Storybook](./storybook.md) — component-isolation states and their accessibility gate.
- [Route bundle budgets](./bundle-budget.md) — the CI check that limits each
  page's first-load JavaScript, run after every web build.

Invited-registration browser scenarios share one IP in the serial managed real-stack
lane. Their fixture resets only `ratelimit:v1:invite-register-ip:*` and the matching
`InvitationPublicController.register` global IP bucket through lease-checked Redis
commands before each scenario. The global bucket uses the guard’s existing SHA-256
controller/handler/IP identity. Per-email and other budgets
remain intact; production limits are unchanged. Rate-limit enforcement is checked
separately in API tests. This fixture cannot run against an owner preview.

### Public-auth server mocks must prove handler use

Tests using `e2e/shared/auth-test.ts` install per-test signup-policy and explicit empty
OAuth-provider handlers. OAuth visibility tests replace the provider default explicitly.
Handler counters prove that the server requested each auth dependency. A hidden Google
button alone proves nothing: the application returns an empty list after provider-fetch errors.
The fixture rejects unexpected upstream/browser traffic and fails teardown when it occurs.
Auth-page scenarios require provider and signup-policy handler hits. New auth scenarios must
use this fixture and preserve those checks. Reset-password scenarios need no invented auth hits.

When changing this boundary, omit the provider handler in an explicit-empty scenario,
run that whole test command with retries disabled, and require a missing-handler failure.
Restore the handler and verify success. Repeat the signup-policy absence check. Preserve
the negative result separately; startup errors are not missing-handler evidence.

<!-- AMCORE_CONSOLE_SUPPORT_MAIL_TESTING_START -->

The support-mail journey has two isolated recipient-completion profiles:
`support-mail-path` and `support-mail-host` in the product-admin real-stack lane.
Both run `console-support-mail.spec.ts` against actual rendered fake-recipient
mail in the internal collector. The source-copy transport retains its final
admission callback; the original Resend SDK has a separate contract test.
See [commands and artifact restrictions](../operations/local-stands.md#support-mail-recipient-completion).
The mock `support-mail` preview cannot prove recipient completion.

<!-- AMCORE_CONSOLE_SUPPORT_MAIL_TESTING_END -->
