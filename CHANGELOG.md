# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Production deploy profile: the build-once/promote-by-digest contract and
  a GitHub Environments setup checklist** (ADR-075). New
  [`docs/operations/production-deploy-profile.md`](docs/operations/production-deploy-profile.md)
  makes concrete a model that was previously described only in prose in
  [`docs/operations/deployment.md`](docs/operations/deployment.md): merge to `main` deploys
  `staging`; a `vX.Y.Z` tag deploys `production` only after re-pulling the
  exact digest `staging` already validated, gated by a required-reviewer
  GitHub Environment approval — never a rebuild from the tag. Includes a
  secrets/variables checklist (registry credentials, deploy keys, the
  migrator-role database URL, application secrets) mapped to
  environment-scoped vs. repo-scoped placement, an OIDC-preference note, and
  a self-hosted-runner isolation warning. This is a reference contract and
  setup checklist, not a live pipeline for AMCore upstream itself — see the
  doc's own "What this isn't" section.
- **Deploy workflow template implementing the production deploy profile
  contract.** New
  [`.github/workflows/deploy-template.yml`](.github/workflows/deploy-template.yml)
  with two structurally different paths, not just differently gated ones: a
  **build path** (`main`) that builds the `api`, `api` migrator, and `web`
  images once and pushes them to GHCR using only the workflow's own
  `GITHUB_TOKEN` (no secret to configure), and a **promote path** (a `v*` tag)
  that builds nothing — it resolves the digest the build path already
  published for that commit and fails loudly if that commit was never
  published, rather than silently building a fresh one. Each path deploys
  behind the matching GitHub Environment the profile doc describes.
  `workflow_dispatch`-only by design — it never runs on `push`/`pull_request`,
  so it adds no new required check and needs no configured secret to keep
  this repository's CI green. The final deploy step on each path is an
  illustrative placeholder until a fork points it at a real target.

## [0.7.0] - 2026-09-05

### Security

- **`apps/web` now ships a real browser security-header baseline and an
  enforced, nonce-based Content Security Policy by default** (ADR-074).
  Previously, `apps/web` emitted no security headers beyond a `/sw.js`
  block, and `apps/api`'s `helmet()` — which never touches `apps/web`'s
  HTML — was documented as covering this, which it did not.
  - Static headers on every response (`Referrer-Policy`,
    `X-Content-Type-Options`, a deny-by-default `Permissions-Policy`,
    `X-Frame-Options`, HSTS without `preload`).
  - A per-request nonce CSP for HTML/navigation requests: `script-src`
    with no `'unsafe-inline'` (a per-request nonce + `'strict-dynamic'`,
    the only mechanism that actually restricts script execution for
    Next.js App Router), Base UI's `CSPProvider` wired globally, and a
    structural guardrail against future CSP-sensitive Base UI components.
  - **Enforced by default in production**, `Report-Only` by default under
    `next dev` (`WEB_CSP_MODE` env var overrides either direction).
  - A minimal, same-origin CSP violation-reporting endpoint
    (`/api/csp-report`), rate-limited and body-capped, logging a redacted
    summary — observability only, not a protection mechanism.
  - See [`docs/frontend/browser-security-and-csp.md`](docs/frontend/browser-security-and-csp.md)
    for the full policy, how to add a third-party origin, and downstream
    route-scoping guidance for public/marketing routes.

## [0.6.0] - 2026-09-04

### Security

- **`apps/web`'s generic authenticated BFF proxy no longer relays inbound
  forwarded/client-IP headers to `apps/api`** (ADR-072). Previously, a
  browser's own `X-Forwarded-For`, `X-Real-IP`, `Forwarded`, and similar
  headers passed through `forwardRequestHeaders()` unmodified — harmless
  today (nothing on the `apps/api` side yet trusts them for the
  `apps/web → apps/api` hop), but a real spoofing vector for any future or
  downstream configuration that trusts that hop. First slice of Track 2
  (BFF client identity, throttling, and forwarded-header spoofing); the
  trusted client-IP relay and API-side verified-peer guard land separately.
- **`docker-compose.yml`'s `api` service now publishes its port to
  `127.0.0.1` by default, not `0.0.0.0`** (ADR-072, final slice of Track 2).
  Previously `api:5002` was reachable from any interface, including the
  public internet on a directly-exposed host — combined with a numeric
  `TRUST_PROXY` hop count (e.g. the documented Caddy quick start,
  `TRUST_PROXY=1`), this created a "multiple, different-length paths to the
  app" condition Express's own docs warn is spoofable. Nothing documented
  needs the broader binding: the bundled Caddy profile and the reference
  nginx config both reach `api` by its Docker network name, never through
  this published port. **If your deployment relies on `api:5002` being
  reachable from another host** (an external reverse proxy not on this
  compose network), set `API_PUBLISH_HOST=0.0.0.0` in `.env` and firewall
  the port yourself — see `docs/operations/deployment.md` → "BFF client-IP
  relay".

### Added

- **`WEB_TRUSTED_CLIENT_IP_HEADER`** (`apps/web`, ADR-072, disabled by
  default). When set to one of `x-real-ip`/`x-forwarded-for`/
  `cf-connecting-ip`/`true-client-ip`/`fastly-client-ip`, `apps/web`'s BFF
  proxy relays that inbound header's value to `apps/api` as a new,
  purpose-specific `X-AMCore-Client-Ip` header — only ever set from this
  resolved value, never a browser-supplied one.
- **`TRUSTED_WEB_PEERS`** (`apps/api`, ADR-072, disabled by default) —
  trusted by the global rate limiter's tracker resolver only when the
  inbound request's actual socket peer (never a forwarded header) is in
  this configured trusted set (real IPv4/IPv6 CIDR matching via Node's
  built-in `net.BlockList`); otherwise falls back to stock `req.ip`,
  identical to pre-ADR-072 behavior. Both this and
  `WEB_TRUSTED_CLIENT_IP_HEADER` above must be set together to get an
  effect — see `docs/frontend/api-consumption.md` → "Client-IP relay to
  `apps/api`" and `docs/operations/deployment.md` → "BFF client-IP relay".
  `getClientIp()`/audit-log IP and the invite-abuse limiter are unaffected.
- **`amcore_queue_paused{queue,role}` metric** — `1` if a queue is currently
  paused, `0` otherwise (`Queue.isPaused()`), replacing the pause signal
  lost from `amcore_queue_jobs` below.
- **`@RateLimit(policy)`/`@SkipRateLimit()`** (`apps/api`,
  `infrastructure/throttling/`) — the only supported way to override or
  exempt a route from the global rate-limit backstop, replacing seven
  duplicated raw literal overrides with two named policies
  (`RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION`, `.EXPENSIVE_ACTION`). A
  metadata regression test (`rate-limit-decorator-coverage.spec.ts`) scans
  every controller and pins that `HealthController`/`MetricsController`
  stay fully exempt.
- **GCRA (Generic Cell Rate Algorithm) rate limiter** (ADR-073) —
  `infrastructure/throttling/` now owns the entire rate-limit mechanism.
  Every policy has a sustained `rate` and an instantaneous `burst`
  (defaults to `rate`) — the capacity concept a fixed-window counter
  cannot express at all, and the actual fix for the originally-reported
  production symptom this starter is meant to prevent by default (a real
  visitor's own page firing several parallel calls, or a few page visits
  in quick succession, tripping the global backstop even with fully
  correct per-visitor identity). Measured, not asserted: the identical
  reported traffic pattern against the old fixed-window defaults produced
  28 of 60 requests refused; against this one, 0 of 60 — permanent
  regression coverage in
  `apps/api/test/rate-limit-symptom-reproduction.e2e-spec.ts`.
- **`amcore_rate_limit_decisions_total{policy,outcome,role}` metric** —
  every global rate-limit admission decision, bounded `policy`
  classification (`default`/`privileged_mutation`/`expensive_action`/
  `custom`) and `outcome` (`allowed`/`refused`) — the calibration signal
  for revisiting `DEFAULT.burst` against real production traffic.

### Changed

- **`apps/web`'s default query retry policy no longer blindly retries every
  error** (ADR-073). TanStack Query's own default retries any error,
  including a genuine client-input 4xx, up to 3 times; `getQueryClient()`
  now never retries a 4xx except `429`, and honours a real `Retry-After`
  header (`ApiRequestError.retryAfterSeconds`) for the retry delay when the
  backend sent one — `apps/api`'s global rate limiter always does. Falls
  back to exponential backoff otherwise. Only `useQuery`/`useInfiniteQuery`
  are affected; `useMutation` never retried by default.
- **Rate-limit headers are now standard and unsuffixed** (ADR-073):
  `X-RateLimit-Limit`/`-Remaining`/`-Reset` and a real `Retry-After`
  (RFC 9110), replacing `@nestjs/throttler`'s non-standard
  `-short`/`-long`-suffixed forms — an unsuffixed `Retry-After` did not
  exist at all before this change. `X-RateLimit-Limit` reports a policy's
  `burst`, not its sustained `rate` (`remaining` counts down from
  `burst - 1` on the very first request from idle, so pairing it with
  `Limit = rate` would be self-contradictory). A global rate-limit refusal
  now also carries a real `errorCode: "RATE_LIMIT_EXCEEDED"` in the
  response body — previously it carried none.
- **`bullmq` bumped to 6** (`apps/api`). Added `ioredis` as an explicit
  dependency (BullMQ 6 no longer bundles it directly). Replaced the removed
  `Queue#client` with the v6 `queue.getBackend().client` escape hatch in
  `QueueService`'s producer-side Redis observability — behavior unchanged.

### Fixed

- **Bare `@SkipThrottle()` was a silent no-op** on `HealthController` and
  `MetricsController` — `@nestjs/throttler`'s bare `@SkipThrottle()` only
  skips a throttler named `'default'`, which AMCore never registered
  (`short`/`long`). Both now use `@SkipRateLimit()`, which is not scoped to
  any named-throttler concept at all; the metadata regression test above
  prevents this class of bug from recurring.

### Removed

- **`@nestjs/throttler` dependency** (ADR-073) — replaced by AMCore's own
  GCRA-based rate-limit mechanism (see Added above): `GcraRedisLimiter`/
  `GcraMemoryLimiter` and `RateLimitGuard`. The ADR-072 client-IP-relay
  trust behavior (`TRUSTED_WEB_PEERS` above) is unchanged, only the
  implementing class moved. See ADR-073 for the full "what this gives up
  vs. gains" rationale.
- **`amcore_queue_jobs{state="paused"}` label value.** BullMQ 6 no longer
  reports a per-job `paused` state — a paused queue's jobs are now counted
  as `waiting`. Any downstream Grafana panel or alert keyed on
  `state="paused"` needs updating to the new gauge above.

## [0.5.0] - 2026-08-29

### Added

- **`PROJECT_CONTEXT.md`:** new downstream-product contract fields —
  `i18n_mode`, `base_locale`, `supported_locales`, `frontend_storybook`,
  `theme_persistence`, `initialized_from_amcore_version` — laying the
  groundwork for the upcoming `pnpm init:brand`/`pnpm init:project` fork
  initialization tooling (ADR-071). AMCore upstream's own current choices are
  now recorded explicitly (`i18n_mode: multi`, `frontend_storybook: enabled`,
  `theme_persistence: local-storage`) rather than left implicit in the code.
- **`pnpm init:brand`** (ADR-071): a repeatable, non-destructive brand/
  identity initializer for downstream forks. Records product identity,
  upstream sync policy, workflow mode, and theme choices into
  `PROJECT_CONTEXT.md`; updates `apps/web`'s PWA manifest and the en/ru
  message catalogues; optionally copies user-supplied logo/icon files,
  validating icon pixel dimensions before copying. `--dry-run` computes and
  prints the full plan plus unified diffs without writing anything; apply
  mode refuses on a dirty git tree or an `ai/` maintainer checkout and runs
  `pnpm typecheck`/`pnpm lint` after writing to catch a broken result before
  it's committed. New root `devDependency`: `@clack/prompts` (interactive
  prompts only; flags use `node:util.parseArgs`). Root `scripts/**/*.mjs`
  also gained lint coverage (`pnpm lint` now runs `eslint scripts`),
  closing a pre-existing gap that let `scripts/dependency-freshness.mjs`
  slip through unlinted.
- **`pnpm init:project --mode=single --locale=<code>`** (ADR-071): a
  one-time, destructive transform that removes locale routing entirely for
  a downstream fork that only ever needs one language — see
  `docs/frontend/i18n-and-errors.md` → "Downstream: running a single-locale
  app". Moves `app/[locale]/*` up, deletes `proxy.ts`/`routing.ts`/
  `navigation.ts`/`params.ts` and the `LocaleSwitcher` feature, rewrites
  every affected import/call site, trims `SUPPORTED_LOCALES`/
  `DEFAULT_LOCALE` (and the `emailMessages`/`telegramGenericMessages`
  catalogues) to the chosen locale, and updates `PROJECT_CONTEXT.md`'s
  `i18n_mode`/`base_locale`/`supported_locales`. Unlike `init:brand`, not
  repeatable — a second run refuses with a clear message rather than
  re-reading files the first run already moved. `--dry-run` computes and
  prints the full plan plus unified diffs without writing anything; apply
  mode runs the same safety guards as `init:brand` plus a real
  `pnpm --filter web build` and the `api`/`web` unit-test suites after
  writing.
- **`pnpm init:project --storybook=disabled`** (ADR-071): a one-time,
  destructive removal of the Storybook surface entirely, for a downstream
  fork that doesn't want the component workshop — see
  `PROJECT_CONTEXT.md`'s `frontend_storybook` field. Deletes `.storybook/`
  and every co-located `*.stories.tsx` file, the CI `storybook` job and its
  Dependency Review advisory allowlist, the `storybook`/`build-storybook`/
  `test:storybook` scripts and every Storybook-only devDependency, the
  `eslint-plugin-storybook` config block, the Storybook Vitest project, and
  `docs/frontend/storybook.md` (updating every other doc that linked to
  it). Independent of the `--mode=single` locale dimension — either flag
  works alone or both together in one `init:project` invocation. Because
  this dimension edits `apps/web/package.json`'s dependencies (unlike the
  locale dimension), automated post-apply verification is skipped in favor
  of a printed manual follow-up: run `pnpm install`, then verify by hand.

### Changed

- **Docs closeout for `pnpm init:brand`/`pnpm init:project` (ADR-071):**
  the root `README.md` fork-onboarding callout, `docs/README.md`,
  `docs/frontend/README.md`, and `docs/frontend/brand-theme-and-tokens.md`'s
  downstream rebrand checklist now point at the actual commands instead of
  a stale "no rebrand CLI/init script in this starter" claim.
  `docs/frontend/storybook.md` gained the parallel "Downstream: disabling
  Storybook" section `docs/frontend/i18n-and-errors.md` already had for the
  single-locale transform.

## [0.4.0] - 2026-08-25

### Upgrading

This release lands the frontend/admin starter phase (Tracks 1-9). Several
changes are fork-breaking if you built on `v0.3.0`'s `apps/web`:

- **`src/views/` is renamed to `src/_pages/`.** A fork importing
  `@/views/...` directly needs to switch to `@/_pages/...`.
- **The grouped `features/auth/*` and `features/sessions/*` slices are
  flattened.** `features/auth/login` → `features/auth-login`, `.../logout`
  → `features/auth-logout`, `.../oauth` → `features/auth-oauth`,
  `.../register` → `features/auth-register`,
  `features/sessions/revoke-session` → `features/sessions-revoke`,
  `features/sessions/revoke-other-sessions` → `features/sessions-revoke-other`.
  The `features/auth` group barrel is removed — a fork importing
  `@/features/auth/...` or `@/features/auth` needs the specific flattened
  slice path.
- **The dashboard's Zustand UI-store sidebar state is removed.**
  `useUIStore`/`UIStoreProvider` no longer exist; shadcn's own
  `SidebarProvider`/`useSidebar()` now owns that state. A fork importing
  either from `@/shared/store` needs its own replacement.
- **`shared/ui`'s `Button` and `Label` are now built on Base UI, not
  Radix.** `Button`'s `asChild` prop is removed — Base UI has no
  equivalent under that name. A fork rendering
  `<Button asChild><a .../></Button>` needs to compose the link/anchor
  directly instead.

See the `### Changed` entries below for the full detail on each.

### Added

- **`apps/web`:** documented per-route client bundle baseline and
  methodology (`docs/frontend/bundle-budget.md`), re-derivable via
  `next experimental-analyze` and the build-native
  `route-bundle-stats.json`. CI-enforced bundle budget is deliberately
  deferred in this PR (data proven stable/non-vacuous via a real regression
  injection, but the analyzer's own size figures are interactive-UI-only
  with no JSON form) — see the doc's "CI enforcement: deferred" section for
  the self-contained reopening condition.
- **`apps/web`:** the full password-reset/email-verification email-link
  flow now has a frontend reference implementation — `/forgot-password`,
  `/reset-password`, `/verify-email`, `/resend-verification`. The backend
  has supported all four since the auth foundation was built; only the
  frontend consumer was missing. New BFF layer
  (`shared/api/bff/public-auth-action.ts`) for the two dedicated-route
  categories that need one (see `docs/frontend/api-consumption.md`);
  `LoginForm` gains its first real "Forgot your password?" link (the
  message key existed unused since i18n foundation work).
- **`apps/api`:** `PATCH /auth/me` now emits an `account.profile_updated`
  in-app notification when a real change was made (best-effort, never for a
  no-op request). The `account.profile_updated` definition previously
  existed with no producer wired to it.
- **`apps/web`:** browser API access now uses a BFF / Token Handler pattern
  backed by a Redis session vault. The browser holds only the opaque
  `amcore_session` cookie; backend access/refresh tokens stay server-side in
  Next Route Handlers. The reference UI now includes BFF-backed login,
  register, logout, Google OAuth entry point (shown only when configured),
  current-user reads/updates, locale persistence, and an active-sessions page.
- **`apps/web`:** added production-style frontend consumption hooks for avatar
  upload/delete, notifications feed/preferences/realtime, and AI
  conversations/runs/messages through the BFF. These are reference hooks, not
  product-specific notification or AI screens.
- **`apps/web`:** a four-layer frontend testing pyramid (ADR-069) —
  `msw/node`-backed integration tests for the real `/api/*` request
  contract; Playwright E2E split into a mocked lane (`page.route()` +
  Next's `experimental/testmode/playwright/msw` fixture, no real infra)
  and a real-stack lane (`docker-compose.yml`'s `local-infra` profile —
  the only layer that proves auth/BFF/cookies/Redis/App Router end to
  end); and `@axe-core/playwright` accessibility scanning (WCAG A/AA
  through 2.2) on the pages/states those E2E lanes already visit. New CI
  job `web-e2e`. Public guide: `docs/frontend/testing.md`.
- **`apps/web`:** Storybook component workshop (ADR-070) — `@storybook/nextjs-vite`
  with theme (`.dark` toggle matching the real app), i18n
  (`NextIntlClientProvider`), query, and MSW decorators (reusing the same
  `msw` handlers as the Vitest integration layer); `@storybook/addon-a11y`
  - `@storybook/addon-vitest` turn every story into a CI-gated
    accessibility check, a fifth layer of the testing pyramid above. Current
    coverage is all 19 `shared/ui` primitives and seven feature-flow references
    (login, register, forgot/reset password, verify/resend email, session
    revoke — the session story is the reference for this starter's real
    toast/mutation/query-invalidation pattern). New CI job `storybook`.
    Public guide: `docs/frontend/storybook.md`.

### Fixed

- **`apps/web`:** four accessibility/correctness defects found while
  building the new E2E and axe layers above, not shipped speculatively:
  the login/register pages had no `<h1>`; the "Sign up"/"Sign in" links
  inside body text relied on color alone at rest, below 3:1 contrast;
  `Alert`'s destructive variant text was below the 4.5:1 AA contrast
  minimum; and the icon-only `LogoutButton` (dashboard header) had no
  accessible name at all.
- **`packages/shared`:** `registerSchema`'s `name` field is optional (may
  be omitted) but `RegisterForm` defaulted it to `''`, which failed that
  same field's own `min(2)` the moment the form validated on submit —
  silently blocking every registration attempt that left the name field
  untouched. A blank string now normalizes to unset before the length
  check runs.
- **`apps/web`:** the destructive button variant's text color now uses a
  proper `--destructive-foreground` token instead of a raw `text-white`
  literal. This also fixes a pre-existing WCAG AA contrast failure in dark
  mode (white text on `--destructive` in dark mode was 3.6:1, below the
  required 4.5:1) — dark mode now uses a dark foreground (`#171717`) against
  the lighter dark-mode destructive red, which passes at 4.76:1. Light mode
  is unchanged (`#fafafa`, 4.63:1).

### Changed

- **`apps/web`:** the FSD Pages layer directory is renamed `src/views/` →
  `src/_pages/`, matching the target name `docs/frontend/architecture-and-conventions.md`
  already documented. A fork importing `@/views/...` directly needs to switch
  to `@/_pages/...`. Alongside the rename, `(dashboard)/page.tsx` now follows
  the route-thinness rule: the route file only reads the session and renders
  a `_pages/dashboard/DashboardPage` composition, rather than inlining JSX
  itself (Track 9, starter cleanup).
- **`apps/web`:** the grouped `features/auth/*` and `features/sessions/*`
  slices are flattened to ungrouped slices — `features/auth/login` →
  `features/auth-login`, `.../logout` → `features/auth-logout`, `.../oauth` →
  `features/auth-oauth`, `.../register` → `features/auth-register`,
  `features/sessions/revoke-session` → `features/sessions-revoke`,
  `features/sessions/revoke-other-sessions` → `features/sessions-revoke-other`
  — matching `features/locale-switcher`'s existing flat shape. The
  `features/auth` group barrel is removed; a fork importing
  `@/features/auth/...` or `@/features/auth` needs to switch to the specific
  flattened slice path (Track 9, starter cleanup).
- **`apps/web`:** `(dashboard)/layout.tsx` is now a real Sidebar app shell
  instead of a fixed header bar — `shadcn add sidebar` (Base UI) via the
  documented scratch-worktree procedure, hand-ported into `shared/ui/sidebar.tsx`
  (plus its `sheet.tsx`/`tooltip.tsx`/`separator.tsx` dependencies), with a
  new `widgets/app-shell` composition (nav, account footer, locale switcher,
  sign-out). The generated primitives shipped with hardcoded English text
  (`Sidebar`'s mobile sr-only heading, `SidebarTrigger`/`SidebarRail`'s
  toggle label, `Sheet`'s close button) — fixed the same way as the existing
  `DialogContent`/`Toaster` `closeLabel` pattern: `Sidebar` requires
  `mobileTitle`/`mobileDescription`, `SidebarTrigger`/`SidebarRail` require
  `toggleLabel`, `SheetContent` requires `closeLabel`. The Zustand
  `sidebarOpen`/`toggleSidebar` UI-store state it used to stand in for is
  removed — shadcn's `SidebarProvider`/`useSidebar()` now owns that state
  directly, and `UIStoreProvider` is removed from the app/Storybook since
  nothing else used the store. A fork importing `useUIStore`/`UIStoreProvider`
  from `@/shared/store` needs its own replacement. The collapsed/expanded
  choice persists across reloads: `(dashboard)/layout.tsx` reads the
  `sidebar_state` cookie server-side (`await cookies()`) and passes it back
  as `defaultOpen`, and the mobile Sheet closes itself on navigate — both
  covered by `e2e/real-stack/app-shell.spec.ts` (Track 9, starter cleanup).
- **`apps/web`:** `shared/ui`'s `Button` and `Label` primitives are now built
  on Base UI (`@base-ui/react`) instead of Radix, per the shared-UI/shadcn
  baseline track. **`Button`'s `asChild` prop is removed** — Base UI has no
  equivalent under that name. A fork rendering `<Button asChild><a .../></Button>`
  needs to switch to composing the link/anchor directly, matching whatever
  render-prop pattern the eventual `docs/frontend/shared-ui-and-shadcn.md`
  guide documents. No other `shared/ui` primitive is affected yet.

## [0.3.0] - 2026-08-09

### Upgrading

This release changes default behavior and import paths that a fork built on
`v0.2.0` may depend on:

- **Default locale changed from Russian to English.** `User.locale`'s column
  default, `User.timezone` (`Europe/Moscow` → `UTC`), and `@amcore/shared`'s
  `DEFAULT_LOCALE` all flipped for _new_ installs. Russian remains a fully
  supported locale — a user who registers with `Accept-Language: ru` or an
  explicit `locale: "ru"` still gets Russian throughout, including email. The
  migration changes column defaults only; existing rows are deliberately not
  backfilled, since a stored value cannot be told apart from a preference the
  user actually chose. If your fork wants existing users moved to the new
  defaults, that is a separate opt-in data migration you must write yourself.
- **Every `apps/web` route now lives under an explicit `/en/...` or `/ru/...`
  locale prefix.** A bare path (e.g. `/login`) redirects to the prefixed
  route rather than rendering directly. Any hardcoded links to unprefixed
  paths need updating.
- **Layer-level barrel imports no longer exist.** `@/features`, `@/shared`,
  and other layer-level import targets were removed. Import the concrete
  module (`@/shared/ui/button`) or the slice's public API
  (`@/features/auth-login`) instead.
- **The DOM `style` prop is now rejected by lint.** Colors must come from
  design tokens; a genuinely dynamic inline style needs an explicit
  `eslint-disable` with a reason.
- **Breaking for forks that added a `message:` string to a shared Zod
  schema.** A schema-level message outranks the frontend's per-parse error
  map and silently defeats localization for that field. Use
  `params: { errorCode }` in a `superRefine` instead.

### Added

- **The frontend architecture and styling contracts are now enforced, not just
  documented.** `docs/frontend/` had promised lint enforcement in four places;
  this delivers it. Layer direction and slice public APIs are checked by
  `eslint-plugin-boundaries`; Tailwind's default palette (including behind
  variants such as `dark:`/`hover:`), raw colours in arbitrary values, and the
  DOM `style` prop all fail lint; and CSS Modules — now a supported styling
  surface for local component CSS — are guarded by Stylelint so colour still
  comes from `var(--token)`. `app/globals.css` is deliberately exempt, since
  that is where the tokens are declared.
  Two consequences for anyone updating a fork: `@/shared/ui` and the other
  layer-level barrels no longer exist as import targets — import the module
  (`@/shared/ui/button`) or the slice (`@/features/auth-login`) — and inline
  `style` on DOM elements is rejected outright, so a genuinely dynamic value
  needs an `eslint-disable` with a reason. New guide:
  `docs/frontend/fsd-boundaries-and-guardrails.md`, which also documents when to
  use `'use client'`, `client-only` and `server-only`. **ADR-066.**

### Fixed

- **Colour contrast was computed from a wrong value for shorthand hex.**
  `hexToRgb` parsed `#fff` as `4095` and returned a plausible-looking but
  incorrect colour with no error, so the WCAG AA token checks would have graded
  the wrong pair had any token used the three-digit form. Shorthand hex is now
  expanded, with a regression test.

- **The ESLint rule banning a process-global Zod locale was silently disabled in
  all application code.** ESLint flat config _replaces_ a rule's options when a
  later block configures the same rule for the same files — it does not merge
  them. Two blocks each set `no-restricted-syntax` for `apps/web/src/**`, so the
  later one won and the `z.config(z.locales.*)` selector vanished from the
  effective config. It survived only in test files, the one place the later
  block was `ignores`d, which is why nothing caught it: the ban applied exactly
  where nobody writes that call and nowhere it mattered. All selectors now live
  in one options object, with a deliberately narrower block relaxing the
  non-ASCII copy rule for test fixtures. `apps/web/src/test/eslint-guards.test.ts`
  now proves each guard fails on the defect it exists for, and fails the build
  if two blocks ever configure `no-restricted-syntax` or `no-restricted-imports`
  over an identical file set again.

- **Links in emails and notifications had no locale prefix.** Since routes moved
  under `/en/...` and `/ru/...`, a server-generated link to a bare path was
  resolved by cookie or `Accept-Language` — which a link _from an email_ cannot
  rely on, because the recipient may open it in a browser that has never visited
  the app. A Russian verification email opened an English page. Verification,
  password-reset, invite-accept, notification CTAs, and the OAuth callback and
  account-linking redirects now build their URL with the new
  `localizedFrontendUrl()` from `@amcore/shared`, using the locale the backend
  already knows.

- **Email durations were hardcoded in Russian regardless of the recipient's
  locale.** `auth.service.ts` built the validity window as
  `` `${hours} часов` `` / `` `${minutes} минут` ``, so an English-locale user
  received an otherwise-English email reading "This link is valid for 24
  часов." The invite email had the same problem via an inline
  `locale === 'en' ? '7 days' : '7 дней'` ternary. Durations are now passed as
  numbers (`expiresInMinutes` / `expiresInHours` / `expiresInDays`) and
  pluralized by the message catalogue through ICU, which also fixes the
  declension — the old strings read "1 часов" and "2 дней" for any count. A test
  now enforces that every locale supplies the CLDR plural categories its
  language requires (`few`/`many` for Russian), which the existing email parity
  guard did not cover.
- Removed the leftover fitness/finance/subscriptions product copy from the
  welcome email in both locales.

### Added

- **Public i18n guide: `docs/frontend/i18n-and-errors.md`** — where copy lives,
  and step-by-step recipes for adding a UI string, adding a backend error code
  end to end, localizing form validation, adding a third locale, and running a
  fork single-locale. Includes the rules that are easy to get wrong and hard to
  notice: never inline user-facing text, never render the backend's `message`,
  never put a literal `message` in a shared schema, never set a global Zod
  locale, and never hand-roll pluralization. `AGENTS.md` carries the short
  version so an agent hits the rules before the guide.

- **Form validation messages are now localized per parse instead of via a
  global Zod locale.** `apps/web` called `z.config(z.locales.ru())` once at
  startup. That setting is process-global, cannot be scoped to a request or a
  render ([colinhacks/zod#4986](https://github.com/colinhacks/zod/issues/4986)),
  and therefore cannot represent two live locales — and being called from a
  `useEffect` it never applied during server rendering at all. Replaced with a
  per-parse error map: build forms with the new `useLocalizedForm(schema)`.
  Server-returned field errors are localized too — `useFormMutation` now
  translates `errors[]` by code via `useFieldErrorTranslator` rather than
  writing the backend's English `message` into the form.
  **Breaking for forks that added `message:` to a shared Zod schema:** a
  schema-level message outranks the per-parse map in Zod's precedence and
  silently defeats localization for that field. The four such messages in
  `packages/shared/src/schemas/api-keys.ts` were removed; those issues already
  carry `params.errorCode`, which the frontend translates. Raw API consumers
  now receive Zod's default `"Invalid input"` in `errors[].message` for those
  four scope-grammar failures — `errorCode` remains the stable field to branch
  on, as `docs/auth/reference.md` documents. An ESLint rule blocks
  reintroducing a global Zod locale.

- **API errors are now localized by `errorCode` instead of showing the
  backend's own message.** ADR-023 has the backend emit stable machine-readable
  codes plus an English, developer-facing `message`, and the frontend translate
  by code — but the frontend half was never built: `getErrorCode()` existed and
  was called nowhere, the forms rendered `response.data.message` verbatim, and
  no catalogue had an `errors` section. A Russian user saw English backend prose
  on every API failure. All 26 codes across the five shared enums are now
  translated in both catalogues, network failures and timeouts get their own
  client-side codes so every failure flows through one path, and
  `shared/api/errors.ts` returns codes only — no user-facing prose remains in
  that layer. Unrecognised codes fall back to a generic message plus the
  `correlationId`, never the backend text. Render failures with the new
  `<ApiErrorAlert>` or `useApiError()`.
  A coverage test derives its expectations from the shared enums, so adding a
  backend code without translating it now fails the build instead of silently
  degrading the UI — which is how the original gap went unnoticed.

### Changed

- **`apps/web` routes now live under a `[locale]` segment** and the web app
  serves both English and Russian. Previously `src/i18n/request.ts` hardcoded
  `const locale = 'ru'` and only `messages/ru.json` existed, so the "i18n-ready"
  setup could not actually render a second language. Every locale is explicit
  in the URL (`/en/login`, `/ru/login`); `/login` redirects to `/en/login` and
  an unsupported locale is a 404 rather than a silent fallback. The prefix is
  deliberately `'always'` rather than the tidier `'as-needed'`, because the
  latter needs a proxy rewrite that Next's standalone server (what the Docker
  image runs) does not apply, turning `/login` into an infinite self-redirect —
  see vercel/next.js#91844. Locale resolution follows URL prefix → the signed-in
  user's stored `User.locale` → the `NEXT_LOCALE` cookie → `Accept-Language` →
  the default, and a new language switcher persists the choice to
  `PATCH /auth/me` so it follows the user across devices and into their email.
  `messages/en.json` is now the source of truth and `ru.json` a full
  translation; a test enforces that the catalogues have identical keys, and
  translation keys are type-checked so a typo fails `pnpm typecheck`. Navigation
  must be imported from `@/i18n/navigation` — an ESLint rule blocks `next/link`
  and the locale-unaware `next/navigation` helpers, which drop the locale
  prefix silently. Also removed the leftover fitness/finance/subscriptions
  placeholder copy from the dashboard and the message catalogue. See
  `docs/frontend/architecture-and-conventions.md` → "Locale routing".
- **Breaking for new installs:** AMCore's base locale is now English. The
  `User.locale` column default changed from `ru` to `en`, `User.timezone` from
  `Europe/Moscow` to `UTC`, and `DEFAULT_LOCALE` in `@amcore/shared` from `ru`
  to `en`. Russian remains a fully supported locale — `SUPPORTED_LOCALES` is
  unchanged apart from ordering, and a user who registers with
  `Accept-Language: ru` or an explicit `locale: "ru"` still gets Russian, as do
  all their emails and notifications.
  **Upgrade note:** the migration changes column defaults only
  (`ALTER COLUMN ... SET DEFAULT`); **existing rows are deliberately not
  backfilled**, because a stored value cannot be distinguished from a
  preference the user actually chose. If your fork has users who never chose a
  locale explicitly and you want them moved to the new defaults, that is a
  separate opt-in data migration you must write yourself.
- Consolidated locale-default handling onto a single source. The default locale
  and the supported-locale list were previously re-declared in six places
  (`@amcore/shared`, a local constant in `notifications.service.ts`, a
  hardcoded `z.enum` in the email job schema, a `'ru'`-defaulting ternary in
  `invite.service.ts`, two verbatim copies of a `toLocale()` helper in the
  notification deliverers, and four inline `as 'ru' | 'en'` casts in
  `auth.service.ts`), so changing the default in one place silently left the
  others behind. All now derive from `SUPPORTED_LOCALES`/`DEFAULT_LOCALE`
  via a new exported `coerceSupportedLocale()` helper, which also replaces an
  unchecked `as SupportedLocale` cast in the notification feed.
- An organization invite sent to an email with no AMCore account is now
  rendered in the base locale rather than always in Russian.

### Added

- Implemented a working light/dark/system theme for `apps/web`, with a
  neutral default token palette and no-flash pre-hydration script — the
  previous theme toggle existed in the Zustand UI store but was never
  wired to the DOM, so the app always rendered a hardcoded dark-violet
  palette regardless of the stored preference. `system` is now the
  default, resolved via a small AMCore-owned module
  (`shared/lib/theme.ts` + `ThemeProvider`) rather than the `next-themes`
  dependency. Added `docs/frontend/brand-theme-and-tokens.md`: token
  architecture, the downstream rebrand checklist, and contrast
  expectations (enforced by a new dependency-free WCAG AA test that reads
  the actual `globals.css` values).
- Generated real PWA manifest icons (`icon-192x192.png`,
  `icon-512x512.png`, `icon-512x512-maskable.png`) from the existing AM
  brand mark — `manifest.ts` previously referenced icon files that didn't
  exist, so the install prompt/splash screen 404'd. The AM logo itself is
  unchanged; only the manifest's leftover personal-product description
  and hardcoded dark-violet colors were replaced with neutral
  starter-appropriate values.
- Documented the frontend architecture contract for `apps/web`: FSD layer
  boundaries on top of Next.js App Router, route-thinness rules, Server/Client
  Component defaults, the server-state-vs-client-state split, and how the
  frontend consumes the backend — `docs/frontend/` (new).
- Documented the avatar upload (`POST /auth/me/avatar`) and AI artifact upload
  (`POST /ai/conversations/{id}/artifacts`) endpoints as `multipart/form-data`
  in Swagger, with a binary `file` field — the Swagger UI "Try it out" panel
  previously had no way to attach a file for either endpoint.
- Documented the API-key management endpoints (`POST/GET/DELETE /api-keys`) in
  Swagger with a proper `api-keys` tag and per-operation summaries — they were
  previously present in `/docs` with no grouping or descriptions at all.
- Documented AMCore API keys as a second named OpenAPI bearer security scheme
  (`apiKeyBearer`, `Authorization: Bearer amcore_live_<id>_<secret>`) in the
  Swagger UI at `/docs`, applied to exactly the ADR-034 allowlisted routes.
  Previously the API-key credential was accepted by the runtime but entirely
  invisible in the published API surface. A new e2e guardrail
  (`apps/api/test/openapi.e2e-spec.ts`) shares the same allowlist as
  `auth-decorator-coverage.spec.ts` so the two can't drift.
- Documented `TELEGRAM_API_BASE_URL` as a supported relay override for
  deployment regions where `api.telegram.org` is network-blocked, in
  `docs/notifications/README.md`'s Telegram channel section and `.env.example`
  (previously only usable by reading the client source — it was labeled as a
  test-only knob).

### Fixed

- Unified the Bull Board dashboard's Swagger tag from `Admin` to `admin`,
  matching the casing already used by every other admin-surface controller —
  previously the Swagger UI sidebar showed two separate groups for what is
  conceptually one area.

## [0.2.0] - 2026-07-27

### Security

- Added an opt-in **`TRUST_PROXY`** setting and stopped trusting client-controlled
  forwarded headers when resolving the client IP. `getClientIp` (used by audit and
  request logs) now returns Express's `req.ip`, which honors `trust proxy` — default
  `false` uses the socket peer (not spoofable); set `TRUST_PROXY` to your proxy
  topology (`loopback`, a subnet/CIDR, or a hop count) behind a trusted reverse
  proxy/LB. Previously `X-Real-IP`/`X-Forwarded-For` were trusted unconditionally,
  letting a caller forge the logged/audited IP.
- Pinned the `apps/api` production/runner Docker base image (`node:24-slim`) to
  a specific digest instead of a mutable tag, and removed the base image's
  bundled `npm`/`npx` from the runner (unused at runtime; source of an
  unpatched base-image CVE).
- Pinned the `apps/web` production/runner Docker base image (`node:24-alpine`)
  to a specific digest instead of a mutable tag, matching `apps/api` (OSSF
  Scorecard's `Pinned-Dependencies` check had flagged it as unpinned).
  Extended `scripts/dependency-freshness.mjs`'s Docker digest-drift check to
  cover both Dockerfiles — it previously only tracked `apps/api`.
- Patched a transitive dev-only `js-yaml@3.14.2` DoS (CVE-2026-53550 /
  GHSA-h67p-54hq-rp68) pulled in via Jest's coverage tooling, now pinned to the
  patched `3.15.0`.
- `strict` repo setup (`scripts/setup-repo-security.sh`) now enables **Dependabot
  security updates** (`automated-security-fixes`) in addition to alerts. Because
  `dependabot.yml` ignores semver-majors, this is the only channel that
  auto-opens a fix PR for a vulnerability whose patched release is a major bump.
  Forks do not inherit repository settings, so this must be applied per repo.

### Changed

- Bumped the minimum/targeted Node.js runtime from 22 (Maintenance LTS) to 24
  (Active LTS) across `engines`, `.nvmrc`, CI, and both `apps/api`/`apps/web`
  Docker base images.
- Modernized Prisma packaging for the API: Prisma Client now uses the Prisma 7
  source-generated `prisma-client` generator, the app runtime image is slimmed by
  excluding Prisma CLI/studio tooling, and production migrations run from a
  dedicated CLI-capable migrator image/target before app rollout.
- Replaced the deprecated `@react-email/components` dependency with a small,
  vendored set of the 10 email JSX primitives AMCore's templates actually use
  (`apps/api/src/infrastructure/email/react-email/`), avoiding both the
  deprecated package and the unified `react-email` package's ~65 MB of
  CLI/dev-server/editor dependencies in the production image.
  `@react-email/render` remains an external dependency.
- Docker Compose health checks now probe the IPv4 loopback `127.0.0.1` instead of
  `localhost`. On minimal/Alpine base images `localhost` can resolve to IPv6 `::1`
  first while the app listens on IPv4, flapping the container to `unhealthy`; the
  explicit IPv4 target keeps the readiness probe deterministic across the images a
  fork may build on.

### Added

- Added TLS/reverse-proxy setup and database backup/restore to
  `docs/README.md`'s "Find the right guide" intent table and its Operations
  documentation-map entry — the top-level docs map didn't mention either
  guide even though `docs/operations/deployment.md` and
  `docs/operations/backup-restore.md` already covered them.
- Added **optional bundled `backup`/`restore` compose profiles**
  (`docker/postgres/backup.sh`, `docker/postgres/restore.sh`,
  `docker-compose.yml`) for the logical-dump fallback described in
  `docs/operations/backup-restore.md`. `COMPOSE_PROFILES=...,backup` runs a
  scheduled `pg_dump` (custom format, atomic rename on success) on
  `postgres:16-alpine` — no third-party backup image — targeting
  `COMPOSE_DATABASE_URL` if set, else the bundled `postgres` service;
  `BACKUP_INTERVAL_SECONDS` (default daily) and `BACKUP_RETENTION_DAYS`
  (default 7, pruned automatically) are configurable. Restore is a one-shot,
  like `migrate` — it never runs on a normal `docker compose up`; it needs
  its own `restore` profile _and_ an explicit `run`:
  `docker compose --profile restore run --rm restore <dump-filename>`
  (`pg_restore --clean --if-exists --no-owner`). This is a logical dump, not
  point-in-time recovery — the doc's honesty caveat and the managed/self-hosted
  PITR guidance are unchanged. `docs/operations/backup-restore.md` also now
  explains the backup interval is a sleep-based countdown (not a wall-clock
  cron schedule), where dumps are stored (the `postgres_backups` volume, and
  how to redirect it for offsite storage), and that logs are Docker logs for
  the backup service (stdout/stderr only, no separate log file). TLS/
  reverse-proxy and backup/restore are now listed in the root `README.md`
  capability table and `AGENTS.md`'s operations pointer, alongside the
  existing `docs/operations/` guides.
- Documented **backup & restore** (`docs/operations/backup-restore.md`):
  which strategy fits which deployment (managed-provider PITR as the
  recommended default; self-hosted WAL archiving via pgBackRest/WAL-G for
  real production; a logical-dump fallback for small/self-hosted
  deployments, with an explicit **dump ≠ PITR** caveat), how the compose
  `backup`/`restore` profiles are used, and what's out of scope (object
  storage, secret rotation, Redis). Cross-linked from `deployment.md` →
  "Rollback" and the operations doc map.
- Added an **optional bundled Caddy `edge` compose profile**
  (`docker/caddy/Caddyfile`, `docker-compose.yml`) for automatic HTTPS with
  minimal configuration. It **replaces** a reverse proxy — not an addition
  alongside nginx/Traefik/a cloud LB — enabled via
  `COMPOSE_PROFILES=...,edge` plus `CADDY_DOMAIN`/`CADDY_EMAIL`/`TRUST_PROXY=1`
  (the shared `x-app-env` anchor now forwards `TRUST_PROXY` to `api`/`worker`,
  default `false`). Fronts `api` by default (a commented block, with
  `CADDY_WEB_DOMAIN` passed through to the `caddy` service, adds `apps/web`
  on a second domain). Unlike the nginx example, Caddy needs no
  `client_max_body_size` or SSE-buffering config, and sanitizes
  `X-Forwarded-*` by default — hence the `TRUST_PROXY=1` recommendation
  (Caddy is exactly one hop). Documented in `docs/operations/deployment.md`
  under "TLS & reverse proxy" → "Optional bundled edge: Caddy", with the same
  compose-only-path honesty caveat as the nginx guidance.
- Documented **TLS & reverse proxy** setup in `docs/operations/deployment.md`:
  the two rules any edge proxy (nginx, cloud LB, Kubernetes Ingress) must
  follow — terminate TLS and forward plain HTTP, and sanitize `X-Forwarded-*`
  (overwrite at nginx, or the exact trusted hop/CIDR via `TRUST_PROXY` for LBs
  that append by default, e.g. AWS ALB) — paired with the existing opt-in
  `TRUST_PROXY` setting, a reference nginx config (current `http2 on;` syntax,
  `client_max_body_size` sized to the AI artifact upload ceiling, header
  overwrite, SSE-tuned location block), and a cloud LB/Ingress note. The prior
  `TRUST_PROXY` explanation under "Realtime SSE behind a proxy" now points
  here instead of duplicating it.
- Extended the backend extension docs: an "Adding an external service / infra
  dependency" guide (config, client/service seams, health, lifecycle, process role,
  tests) alongside the environment-variable guide, an `AGENTS.md` pointer to the env
  workflow + coverage guard, and actionable failure messages on the coverage guard.
- Added a CI guard (`apps/api/src/env/schema/env-example-coverage.spec.ts`) that
  fails if `.env.example` drifts from the env schema — every schema key must be
  documented (active or commented) and no example key may be unknown to the schema
  (compose-only and dynamic `WEBHOOK_*_SECRET` keys are allow-listed). Completed
  `.env.example` into a full reference (GitHub/Apple OAuth, Telegram callback, RBAC
  cache knob) and documented the flow in the backend "Adding an environment
  variable" guide.
- Added a weekly **Dependency freshness** workflow
  (`.github/workflows/dependency-freshness.yml` + `scripts/dependency-freshness.mjs`)
  that upserts a single tracking issue listing the update signals Dependabot does
  not raise: ignored semver-major npm updates, Docker base-image digest drift, and
  newer curl-pinned CLI tool releases. Report-only — it opens no PRs.
- Added the email extension contract for downstream product emails, including
  `NotificationsService` vs `EmailService` selection, template wiring, queueing
  rules, required tests, and secret-bearing email invariants.
- Documented repository workflow modes (`strict`, `flexible`, `custom`) so
  downstream products can choose their GitHub enforcement model instead of
  inheriting AMCore upstream's strict protected-`main` workflow by default.
- AI capability layer — multimodal foundation (Track C, Arc G). Storage-backed **image (JPEG/PNG/WebP)
  and PDF** artifacts with capability-gated routing. **Upload** (`POST /ai/conversations/:id/artifacts`,
  bearer, owner-only, throttled): magic-byte validated (never the client `Content-Type`; no GIF/SVG),
  stored **private** (never a public/signed URL), recorded as an `UNTRUSTED` `AiArtifact`. **Run input**
  references artifacts by id (`artifact_ref` content parts); at run creation the producer validates each —
  conversation scope (no-leak `400`), the frozen model's capability (`vision`/`pdf`), the bound assistant's
  `allowedModalities`, a per-message count + raw-byte budget, and a **rebind matrix** (an artifact may be
  reused only after its bound run is `FAILED`/`CANCELLED`/`EXPIRED`; `409` on
  `QUEUED`/`RUNNING`/`WAITING_APPROVAL`/`WAITING_HUMAN`/`COMPLETED`) — all in the run-creation transaction.
  The **worker** fetches bytes server-side and inlines them into a multimodal provider request as sibling
  parts inside the **same Arc D untrusted user-turn container** (never `system`); the system instruction
  gains a multimodal untrusted-data policy (defense in depth). **Download**
  (`GET /ai/conversations/:id/artifacts/:artifactId`, app-mediated, attachment + `nosniff`, no Range) is
  owner-or-cross-user-operator, matching the Arc F transcript posture (step-up + bounded reason for a
  cross-user operator), with a content-free **fail-closed** `ai.conversation.artifact_accessed` audit
  before bytes are served. A new strict audit path (`record({ failOpen: false })`) also **retroactively
  hardens the Arc F transcript read**, which previously used the fail-open path. Operator/owner human
  turns are restricted to text (`artifact_ref` rejected). New env: `AI_ARTIFACT_MAX_IMAGE_BYTES`,
  `AI_ARTIFACT_MAX_DOCUMENT_BYTES`, `AI_ARTIFACT_MAX_PARTS_PER_MESSAGE`. Guardrails scan text only — text
  rendered inside an image/PDF is **not** scanned (a documented OWASP LLM01 residual; contained by channel
  separation, never claimed eliminated). No new migration (the Arc A `AiArtifact` schema was laid whole).
- AI capability layer — assistant registry admin + runtime application + human takeover / operator review
  (Track C, Arc F). **Assistant registry admin** (`admin/ai/assistants`, SUPER_ADMIN, bearer-only):
  create / publish an **immutable** version / in-place `enabled`+`displayName` patch (mutations are
  step-up + audited), plus role-gated list (latest-per-slug) / get. **Runtime application** of the bound
  assistant: the `enabled` kill-switch gates binding (`400`), run creation (producer `409`), and execution
  (terminal `assistant_disabled`); the
  `systemPrompt` becomes the trusted `system` instruction (the code-owned structural boundary policy is
  always appended — the Arc D boundary is never weakened); `modelSelection` freezes the run model
  credential-gated across `[modelSlug, ...fallback]`, and a pinned uncredentialed model fails run creation
  `503 model_not_configured` (never a silent `mock` downgrade); `toolAllowlist` is unchanged from Arc E.
  **Ownership fence activated (ADR-049):** each run freezes the conversation's `ownershipGeneration`; a
  human takeover increments it, and the worker refuses to write once it moves — at preflight, a loop-top
  early exit, and an authoritative in-tx fence on every durable write — terminalizing
  `cancelled`/`superseded_by_human` with no stale transcript/step/terminal row. **Takeover / release /
  transcript / operator-message** (bearer; owner or cross-user SUPER_ADMIN operator; API keys `401`;
  not-visible `404`): take control also supersedes unleased bot runs + voids their pending approvals under
  the shared approval-driven lock (a later decision is a `409` non-effect); an operator turn requires
  currently holding control (`409` else) and is a `role=ASSISTANT` message authored `OPERATOR`
  (cross-user) / `USER` (owner). The **owner may always reclaim/release their own conversation**; a
  different SUPER_ADMIN on a held conversation gets `409`. A **cross-user operator** needs step-up
  freshness (`403 STEP_UP_REQUIRED`) **and** a bounded reason/ticket ref on every action incl. the
  transcript read (via the `x-amcore-operator-reason` header, not a query param). **Privacy posture
  (accepted):** a SUPER_ADMIN can read a user's private AI transcript cross-user — gated by step-up + a
  mandatory reason and **audited** (`ai.conversation.transcript_accessed`, fail-closed before serving);
  owner reads are not audited. **Content-free everywhere:** message/prompt/reason text never enters
  audit/logs/metrics — audits (`ai.conversation.taken_over`/`released`/`operator_message`/
  `transcript_accessed`, `ai.assistant.*`, per-approval `ai.approval.expired`) carry only bounded
  ids/codes; the operator reason (body + header) and message `content` are redacted in the Pino serializer
  **and** the source-side `sanitizeHeaders()`; metrics
  (`amcore_ai_conversation_control_total{action,actor_role,role}`, `amcore_ai_assistant_admin_total{action,role}`)
  carry only bounded labels. New audit targets `AI_ASSISTANT`/`AI_CONVERSATION`; no new env var (cross-user
  step-up reuses `STEP_UP_MAX_AGE_SECONDS`). No product bot ships; process-role split keeps the whole
  surface web-only (worker owns only the fence).
- AI capability layer — self-hosted tool loop + human-in-the-loop approvals (Track C, Arc E). Turns the
  Arc C single-shot executor into a **bounded, durable, worker-executed agent loop** over **code-owned
  tools**, gating SENSITIVE/DESTRUCTIVE calls behind a **durable human approval**. No product tools ship
  — only the reusable engine + one SAFE reference tool (`current_time`); the default assistant tool
  allowlist is empty, so a fresh starter is never autonomously tool-capable. **The SDK never executes
  tools** — the gateway only returns the model's requested call; a tool runs **only** host-side in the
  worker after its `AiToolInvocation` is persisted. **Process roles (ADR-041):** the tool registry, the
  loop executor + host-side dispatcher, the approval parker, and the approval-expiry `@Cron` are
  **worker-only**; the approval HTTP surface + cancel-while-waiting are **web-only** — neither leaks into
  the other DI graph (process-role e2e gate). The loop offers only tools that are BOTH registered AND on
  the conversation assistant's `toolAllowlist`, allows **at most one tool call per provider step** (0 →
  `COMPLETED`; 1 SAFE → execute host-side + continue; 1 non-SAFE → park; `>1` → `too_many_tool_calls`;
  unknown/not-allowlisted → `tool_not_allowed`), is bounded by `AI_TOOL_LOOP_MAX_STEPS` provider steps
  (`tool_loop_exhausted`) + the run deadline + a per-step lease renewal, and ledgers **one
  `AiUsageLedger` row per provider call**. Each tool result **re-enters the model as untrusted data**
  through the same Arc D salted boundary and the output guard runs every step over the user **and**
  tool-result markers (indirect injection mitigated, never eliminated); crash-safe resume reconstructs
  from Postgres and never re-runs an applied invocation. A non-SAFE call **parks** the run
  (`RUNNING → WAITING_APPROVAL`, lease released) with `AiApproval(PENDING)` +
  `AiToolInvocation(AWAITING_APPROVAL)`; the **owner** approves/rejects, the run re-queues without
  consuming a retry attempt, and the resumed worker executes the approved tool (its `APPROVED →
EXECUTING` CAS is the sole gate for a non-SAFE tool) or feeds a fixed rejection notice. A worker-only `@Cron` sweep expires overdue approvals
  (`FOR UPDATE SKIP LOCKED`, DB-owned): the run's own deadline → `EXPIRED` (`deadline_exceeded`), the
  approval TTL only → `FAILED` (`approval_expired`); cancel-while-waiting terminalizes the run
  `CANCELLED` and voids the gate. Endpoints (bearer, owner-scoped, 404 on not-owned): `GET /ai/approvals`
  (`?status=`), `POST /ai/approvals/:id/decision` (`{ decision, reason? }`; idempotent same-decision
  `200`, conflicting/stale `409`); `GET /ai/runs/:id` gains a `pendingApprovalId` hint. Content-free
  audit: the **approval lifecycle** (`ai.approval.requested`/`approved`/`rejected`/`expired`) is written
  **in the same transaction** as its state-change CAS (security evidence — a committed decision/park/
  expiry can never lack its row); **tool-execution** audit (`ai.tool.invoked`/`execution_failed`) is
  best-effort. Targets `AI_TOOL_INVOCATION`/`AI_APPROVAL`; allowlisted metadata only — never
  args/results/prompts/reason text. Plus bounded metrics
  (`amcore_ai_tool_invocations_total{tool_id,risk_class,outcome}`, `amcore_ai_approvals_total{kind,state}`,
  `amcore_ai_tool_loop_steps`). New env: `AI_TOOL_LOOP_MAX_STEPS`, `AI_TOOL_EXECUTION_TIMEOUT_MS`,
  `AI_APPROVAL_TTL_MS`. See [`docs/ai/README.md`](docs/ai/README.md).
- AI capability layer — prompt-injection guardrail baseline (Track C, Arc D). Defense-in-depth
  containment per OWASP LLM01, applied by the worker around every run: a **structural trust boundary**
  (a code-owned trusted `system` instruction + the untrusted user turn JSON-encoded in a salted
  `<amcore:user-data-{nonce}>` container with `<`/`>`/`&` escaped, so a forged closing marker can
  never appear as a token; the nonce is collision-hardening, not a secret; provider-agnostic
  `system`+`messages` only), deterministic **low-false-positive input/output guards**, and a **safe
  refusal**. The input guard is gated by `AI_GUARDRAIL_INPUT_MODE` (`off` | `flag` default | `block`)
  and hard-blocks only an attack on AMCore's own envelope/markers — generic jailbreak phrasing merely
  flags, so a benign prompt that discusses/quotes injection is never blocked; the output guard (always
  on) discards a leaked/disclosing model output before persistence; oversized input
  (`AI_GUARDRAIL_MAX_INPUT_CHARS`) is refused. A guardrail block is a terminal, non-retryable `FAILED`
  run with a bounded `terminalReasonCode` (`guardrail_input_blocked` / `guardrail_output_blocked` /
  `guardrail_input_too_large`) plus a fixed canned refusal turn (`role=ASSISTANT`, author `SYSTEM`,
  redaction-classified) and content-free `GUARDRAIL_CHECK`/`OUTPUT_VALIDATION`/`REFUSAL` steps. A
  small, in-repo, license-clean adversarial corpus drives the guards as a **regression signal, not a
  security guarantee** — prompt injection is mitigated and contained, never eliminated; indirect
  injection via tools/files is deferred to later arcs that reuse this boundary. Content-free telemetry
  adds `amcore_ai_guardrail_checks_total{stage,verdict,role}` (no prompt/output/marker/category ever a
  label). New env: `AI_GUARDRAIL_INPUT_MODE`, `AI_GUARDRAIL_MAX_INPUT_CHARS`.
- AI capability layer — durable runs + run API (Track C, Arc C). Wires the `ModelGateway` into a
  worker-only durable run engine and a bearer-authenticated HTTP surface. **Process roles
  (ADR-041):** the **web** role creates/reads runs and hosts the SSE stream; the **worker** role is
  the only one that calls a provider — `ModelGateway`, the SDK adapters, the executor, the BullMQ
  processor, and the recovery cron are absent from the web DI graph (enforced by a process-role e2e
  gate). **Durability (ADR-052 pattern):** BullMQ is a wake hint; Postgres owns the run state
  machine, the 10-minute lease, the retry schedule (`maxAttempts` = 3, exponential backoff + jitter;
  the gateway `retryable` flag decides retry vs terminal, SDK retry stays disabled), and a
  per-replica recovery cron + expired-lease reaper (a lost wake is still drained). A claimed run
  runs one `generateText` call, then finalizes the assistant `AiMessage` + bounded `AiRunStep`s + a
  run-attributed `AiUsageLedger` row + the terminal-status CAS in **one transaction** — so the
  provider effect is **at-least-once** but the durable outcome is **exactly-once** (success is never
  faked without a durable transcript + ledger). Endpoints (bearer, owner-scoped by
  `conversation.ownerUserId`, 404 on not-owned): `POST /ai/conversations`, `GET
/ai/conversations/:id`, `POST /ai/runs` (idempotent on `(conversationId, idempotencyKey)`), `GET
/ai/runs/:id`, `GET /ai/runs` (keyset cursor, newest first), `POST /ai/runs/:id/cancel`
  (cooperative), and `GET /ai/runs/:id/stream` — a **status-only** SSE stream (ADR-053 primitives,
  AI-scoped copy) that emits content-free `{ eventId, runId, status, reason }` hints to **refetch**
  the run; **not token streaming**, at-most-once across replicas via Redis Pub/Sub, no sticky
  sessions. New env (all optional): `AI_REALTIME_NAMESPACE`, `AI_REALTIME_HEARTBEAT_MS`,
  `AI_REALTIME_MAX_PER_USER`, `AI_REALTIME_MAX_CONNECTIONS`, `AI_REALTIME_QUEUE_DEPTH`,
  `AI_REALTIME_MAX_STREAM_LIFETIME_MS`, `AI_REALTIME_PUBLISH_TIMEOUT_MS`,
  `AI_REALTIME_MAX_INFLIGHT_PUBLISH`. New content-free metrics: `amcore_ai_run_realtime_connections`,
  `amcore_ai_run_realtime_publish_total`, `amcore_ai_run_realtime_events_total`. See
  [`docs/ai/README.md`](docs/ai/README.md).

- AI capability layer — runtime gateway (Track C, Arc B). A provider-agnostic `ModelGateway`
  over the Vercel AI SDK backed by the DB-backed catalog registry. `generateText` runs
  non-streaming text over the resolved model — an explicit slug or the **credential-gated
  default** (the `isDefault` model when its provider has a key, else the key-less `mock`, so a
  fresh fork works out of the box). `generateObject` adds **capability-gated** structured output
  validated against a Zod schema (real `response_format: json_schema` for OpenAI-compatible
  providers). Ships a deterministic `mock` plus two SDK adapters: Anthropic, and one
  OpenAI-compatible adapter serving OpenAI, OpenRouter, Yandex AI Studio, and any compatible
  endpoint — **per-family base URL and auth are code-owned** (Yandex uses an `Api-Key` header) and
  a catalog `baseUrl` is honored only for the generic compatible type, so a tampered row cannot
  redirect a credential. A row's logical `credentialSlot` resolves to a fixed env key through a
  code-owned allowlist (never a raw `process.env` index). Provider failures normalize to a bounded
  machine-readable taxonomy with a `retryable` flag (the SDK's own retry is disabled — retry is
  Postgres-owned at the durable-run layer). Each successful generation appends an `AiUsageLedger`
  row and increments content-free metrics (`amcore_ai_generations_total`, `amcore_ai_tokens_total`);
  no prompt/response content, model slug, or credential is ever a metric label or log field. New
  env: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `YANDEX_API_KEY`,
  `AI_OPENAI_COMPATIBLE_API_KEY`, `AI_REQUEST_TIMEOUT_MS`, `AI_CATALOG_CACHE_TTL_SECONDS` (all
  optional). The gateway is not yet exposed over HTTP — the run worker and run API arrive in a later
  arc. See [`docs/ai/README.md`](docs/ai/README.md).

- AI capability layer — foundation (Track C, Arc A). A provider-agnostic AI control plane
  on its own `ai` Postgres schema. This first arc ships **persistence and shared contracts
  only — no runtime provider call yet**. Persistence: a DB-backed, admin-manageable catalog
  (`AiProvider` / `AiModel` / `AiModelPolicy` / `AiAssistant`) where provider `type` is a
  closed enum but capabilities/modalities are open bounded strings, and a provider references
  a logical `credentialSlot` (resolved through a code-owned allowlist, never a raw env name —
  no secret is stored); durable `AiConversation` (with a monotonic takeover fence) /
  `AiMessage` transcript; `AiRun` (a Postgres-owned state machine with inert lease/retry
  columns reused from the notification durability pattern) / `AiRunStep`; `AiToolInvocation` /
  `AiApproval` for the self-hosted tool loop + human-in-the-loop; `AiArtifact` (multimodal,
  trust-tagged); and `AiUsageLedger` (an authoritative snapshot/no-FK accounting record that
  survives user/org/model deletion). Shared Zod contracts (`ai-common`, `ai-enums`,
  `ai-catalog`, `ai-assistants`, `ai-runs`) cover the catalog admin surface, the bounded
  capability map, a precision-safe decimal-string cost, lowercase wire enums, and the
  multimodal content-part contract. `db:seed` seeds the intended shape (enabled `mock` +
  Claude default + disabled OpenAI/OpenRouter/Yandex/OpenAI-compatible examples) so a fork
  sees it without live keys. The runtime gateway, durable run worker, guardrails, tool loop,
  and human takeover have since shipped in Arcs B–F; multimodal routing remains a later arc. See
  [`docs/ai/README.md`](docs/ai/README.md). Also fixes the Prisma 7 seed-client construction
  (driver adapter) so `db:seed` runs.

- Telegram notification channel (notifications Arc D). A third external channel
  alongside in-app and email. A bearer user issues a one-time deep link
  (`POST /notifications/telegram/link`), opens the bot and presses **Start**; an inbound
  webhook (`POST /webhooks/telegram`, authenticated by a constant-time
  `X-Telegram-Bot-Api-Secret-Token` header — a new verifier family on the ADR-044
  primitive) binds the chat to the account in one transaction with durable `update_id`
  dedupe (effect-once), a one-time hashed token consumed only on a fully successful bind,
  and never silently moving a chat owned by another account. `GET /notifications/telegram/
connection` reports status; `DELETE …/connection` unlinks (cancelling pending
  deliveries). Outbound delivery is drained by the existing worker-only dispatcher through
  a direct Bot API client (plain text, no `parse_mode`); an unlinked user is an observable
  `SKIPPED telegram_not_linked` (never a retry storm), a blocked/chat-not-found destination
  fences the connection, and a `429 retry_after` is honored as a retry **floor** (clamped
  to 24h, never the 15-min cap). Opt-in via config; `apps/web` stays a stub (the deep link
  is returned as a string). Deploy registers the webhook once with
  `node dist/cli/telegram-setup.js`. See
  [`docs/notifications/README.md`](docs/notifications/README.md),
  [`docs/operations/webhooks.md`](docs/operations/webhooks.md), and
  [`docs/operations/deployment.md`](docs/operations/deployment.md).

- Realtime in-app notification stream (notifications Arc C). A bearer-authenticated
  Server-Sent Events endpoint `GET /notifications/stream` pushes a content-free hint
  (`created` / `read` / `archived` / `unread_changed`) whenever the recipient's feed
  changes, so a client refreshes without polling — Postgres stays the source of truth
  and every event means "refetch". Cross-replica fan-out runs over an environment- and
  version-namespaced Redis Pub/Sub channel with one dedicated subscriber per web
  replica and **no sticky sessions**; delivery is at-most-once and a dropped hint is
  recovered by the next reconnect refetch. The endpoint is a manual bounded writer (not
  `@Sse`): admission is enforced before any bytes (per-user cap → 429, global
  per-process cap → 503), the stream closes at access-token expiry (bounded by a server
  cap), a slow consumer is disconnected on write-buffer overflow, and the access token
  is sent via the `Authorization` header (never the URL). Tunable via
  `NOTIFICATIONS_REALTIME_*` env vars — deployments sharing one Redis must set a distinct
  `NOTIFICATIONS_REALTIME_NAMESPACE`. No JS client ships (`apps/web` stays a stub); the
  documented client contract and proxy/HTTP-2 guidance are in
  [`docs/notifications/README.md`](docs/notifications/README.md) and
  [`docs/operations/deployment.md`](docs/operations/deployment.md).
- Durable external notification delivery (notifications Arc B). A worker-only
  dispatcher drains `PENDING` deliveries with a Postgres `FOR UPDATE SKIP LOCKED`
  claim, leases each attempt, and owns the retry schedule and immutable attempt
  history — BullMQ is only a one-attempt wake hint, and a recovery `@Cron` (on
  every replica, not singleton-locked) drains a delivery whose wake was lost or
  that came from `notifyTx`. Finalize is a `(id, leaseToken)` compare-and-set, so
  a stale lease holder can never overwrite newer state; an expired lease is
  reaped (`ABANDONED` attempt → reschedule or fail). Ships the **email channel**:
  a worker-only adapter over `EmailService.send()` with a stable provider
  idempotency key (`notification-delivery:<id>`) that never enqueues the email
  queue, sent to a **verified** account-email destination only (an unverified
  address yields a `SKIPPED` delivery, never a retried `PENDING`). Adds a daily
  worker-only retention sweep (archived −30d, read −90d, unread −180d, finished
  attempts −30d) that never deletes a notification with an active delivery.
  First production definition: `account.password_changed` (security; in-app +
  email, both mandatory).
- Reusable notifications subsystem (in-app surface). Own `notifications`
  Postgres schema with a canonical per-user `Notification`, per-target
  `NotificationDelivery`, and immutable `NotificationDeliveryAttempt`;
  in-app delivery is inserted `DELIVERED` in the same database transaction as
  the canonical row, so the feed never depends on a worker. Bearer-authenticated
  HTTP surface for the recipient-scoped feed (cursor `(createdAt DESC, id DESC)`,
  no `total`), unread count, mark-read / mark-all-read / archive (idempotent),
  capabilities, per-`(category, channel)` preferences, and the master toggle
  (`PATCH /notifications/settings`). Internal `NotificationsService.notify()`
  and transaction-aware `notifyTx(tx, …)` are the only ways to create a
  notification — there is no public create endpoint. Required namespaced
  idempotency key with a stored payload fingerprint: a same-key retry with a
  matching fingerprint replays the existing row, a mismatching fingerprint
  fails stably. Definitions are code-owned and declare payload schema +
  default / mandatory channels + content classification + a localized
  `renderInApp`; titles and bodies are rendered server-side from the structured
  payload in the recipient's current `User.locale` at feed read time. (Email
  delivery shipped in Arc B, realtime SSE fan-out in Arc C, and the Telegram
  channel in Arc D — all above; Web Push and the triggered follow-ons remain
  future work.)
  Fork-facing guide: [`docs/notifications/README.md`](docs/notifications/README.md).
- Backend Architecture & Conventions guide
  (`docs/backend/architecture-and-conventions.md`): the end-to-end recipe for
  adding a module — boundaries, shared Zod contracts, process-role composition,
  the external-state fencing pattern, and the required OpenAPI/process-role tests.
- Explicit request-body size limit of 100 000 bytes (decimal) for JSON and
  urlencoded bodies, applied globally — including raw-body webhook routes — and
  shared by the production and e2e bootstraps so the limit is identical in both.
  The limit is measured against the decoded body (after any `Content-Encoding`
  inflation), not the wire size. An oversized body is rejected before route
  guards run (so a webhook signature is never evaluated for a too-large payload)
  and surfaces as `413 Payload Too Large` with a stable `PAYLOAD_TOO_LARGE` error
  code instead of a generic 500. Signature verification is unaffected — the
  verifier hashes `req.rawBody`, the decoded body buffer; multipart uploads keep
  their own Multer limit.
- Every public endpoint now documents its success response body and status code
  in the OpenAPI spec (`/docs`). Responses are declared with `@ZodResponse`, which
  keeps the runtime serialization, the TypeScript return type, and the generated
  schema in sync from a single source; a generated-spec test fails if a new
  handler ships without a typed success response.
- User locale is now resolved at registration and editable afterwards. `POST
/auth/register` accepts an optional `locale` (`ru`/`en`) and, when it is
  omitted, negotiates the best supported language from the `Accept-Language`
  header before falling back to the default. New OAuth users are seeded the same
  way from the language negotiated when the login flow started (an existing
  user's stored preference is never overwritten).
- `PATCH /auth/me` (Bearer only) to update the current user's `name`, `locale`,
  and `timezone`. Only supplied fields change; `timezone` is validated as an IANA
  zone and an explicit stored `locale` always wins over `Accept-Language`
  thereafter.

### Changed

- Hardened the mock email provider to log metadata only, avoiding rendered HTML
  or plaintext previews that could contain secret token URLs.
- The `account.password_changed` security alert now also delivers to Telegram for a
  linked user (Arc D), as an **optional, non-mandatory** default channel — generic
  plain-text, disableable in preferences, and a no-op (`SKIPPED`) for an unlinked user.
  In-app and email remain mandatory and unchanged.
- Password reset now marks the account email **verified** in the same
  transaction as the password update: a successful reset proves control of the
  account mailbox (the single-use token was delivered there and returned), per
  OWASP Forgot Password / NIST 800-63B. The reset token is also consumed
  atomically (a guarded conditional update), so two concurrent resets cannot both
  succeed on one single-use token. The password-changed confirmation is now
  emitted through the durable notifications subsystem (`account.password_changed`)
  instead of a one-off queued email; the standalone `PASSWORD_CHANGED` email
  template/path was retired (`welcome` is now the only queued email template).
- API production build no longer compiles test artifacts into `dist` (and thus
  the runtime image): `.swcrc` now excludes `*.spec.ts`, `*-spec.ts`, `__tests__`,
  and `__mocks__` (SWC ignores the `tsconfig.build.json` excludes). Removed the
  redundant `@types/uuid` (uuid v13 ships its own types).
- Bumped `zod` (4.3 → 4.4) and `sharp` (0.34 → 0.35). No runtime behavior change
  in AMCore: the env-schema `z.preprocess` helpers now annotate the stable
  `z.ZodType` base (zod 4.4 renamed the internal `ZodPipe` wrapper to
  `ZodPreprocess`, PR #5929), and the `sharp` image processor imports the
  `Metadata`/`Sharp` types by name (sharp 0.35 dropped the default-import
  namespace). **Note for forks:** sharp 0.35 requires Node.js ≥ 20.9.0 (AMCore
  already targets Node 22).

### Fixed

- Concurrent avatar uploads/deletes for the same user no longer corrupt storage.
  A monotonic per-user generation (`User.avatarGeneration`) fences every avatar
  mutation: the publish/delete is a conditional update that only lands while the
  stored generation is older, and a mutation only sweeps versions strictly older
  than its own. So a request that lost the race can neither overwrite the newer
  `avatarUrl` nor delete the live version — previously one upload's cleanup could
  delete the version another upload just published, leaving `avatarUrl` pointing at
  deleted storage. A per-user Redis lock serializes the common case; under
  contention, a lost race, or a Redis outage the request fails closed with a
  retriable `503` (`AVATAR_LOCKED`).
- Sign in with Apple now works end-to-end on the web. Apple uses
  `response_mode=form_post` and POSTs the callback, but only a GET callback
  existed (the POST 404'd) and the `SameSite=Lax` binding cookie was never sent
  on Apple's cross-site POST. Added a `POST /auth/oauth/:provider/callback`
  sharing one handler with the GET path, a dedicated `SameSite=None; Secure`
  binding cookie scoped to the Apple callback path, and first-login display-name
  capture from Apple's `user` field. Other providers are unchanged.
- Corrected auth token-verification and password-reset entropy documentation,
  avatar storage/media/API architecture documentation, and stale version,
  SHA-256, and media module comments.
- Reconciled `docs/auth/email-auth.md` with runtime: registration returns
  `201 Created` (not `200`), `GET /auth/me` wraps the user in a `user` envelope,
  invalid reset/verify tokens return `401` (not `400`), and the response examples
  no longer show a non-returned `systemRole` field.

### Security

- Closed two code-scanning findings on the security tooling rather than the app.
  `yaml` is pinned to 2.8.3 on the 2.x line (CVE-2026-33532 stack-overflow DoS;
  `lint-staged` still resolved 2.8.2, dev-only). The production Docker **runner**
  stage no longer inherits Corepack/pnpm (`FROM node:22-slim` instead of `base`):
  the container only runs `node dist/main.js`, and the one-shot migration runs the
  Prisma binary from the self-contained bundle, so pnpm is never used at runtime.
  This removes Corepack's bundled `undici` (CVE-2026-12151) from the shipped image
  and trims its attack surface. Verified on the built image: no Corepack pnpm
  cache, no runnable pnpm, and no `undici` package present.
- Resolved the 2026-06-20 transitive-advisory batch via `pnpm-workspace.yaml`
  overrides, all within the parents' declared ranges: `multer` 2.2.0
  (`@nestjs/platform-express`), `form-data` 4.0.6 (`axios`), `hono` 4.12.25,
  `vite` 7.3.5, and the dev/build-only `undici` 7.28.0 (`testcontainers`),
  `piscina` 4.9.3 (`@swc/cli` / `@nestjs/cli`), `@babel/core` 7.29.6. `js-yaml`
  was pinned to 4.2.0 on the 4.x line only (GHSA-h67p-54hq-rp68) at the time, since
  no fix existed yet for the dev-only 3.x consumer (`@istanbuljs/load-nyc-config`,
  coverage tooling). The later CVE-2026-53550 follow-up (see `[Unreleased] >
Security` above) now also pins 3.x to the backported `3.15.0` fix.
- Bumped the `protobufjs` override to 7.6.3 and `tmp` to 0.2.7, closing three
  transitive advisories (two high, one medium). `protobufjs` stays on the 7.x
  line its parents require (`@nestjs/terminus` > `@grpc/grpc-js`, and the dev-only
  `testcontainers` > `dockerode`); `tmp` is dev-only via `testcontainers`.
- Resolved transitive dependency advisories (`protobufjs`, `tmp`, `fast-uri`,
  `rollup`, `lodash`, `brace-expansion`, `picomatch`) by materializing pnpm
  version overrides. The overrides were previously declared under
  `package.json` `pnpm.overrides`, which pnpm 11 silently ignores; they now live
  in `pnpm-workspace.yaml` and are reflected in the lockfile. `brace-expansion`
  is pinned per major line (v1/v5) so the patched v5 is not forced onto v1
  consumers.
- Upgraded `next` to 16.2.9 and `next-intl` to 4.13.0, closing the Next.js
  advisories (middleware/proxy bypass, SSRF, XSS, cache poisoning, DoS) and the
  `next-intl` open-redirect / prototype-pollution advisories.
- Bumped `uuid` to 13.0.2 and the `protobufjs` override to 7.5.8 (newer advisory
  than the previous 7.5.6 pin). Forced the dev-only `uuid@10` (testcontainers)
  to the patched 11.1.1.
- Patched remaining transitive advisories via overrides: `@grpc/grpc-js` 1.14.4,
  `hono` 4.12.21, `@hono/node-server` 1.19.13, `postcss` 8.5.14, `ws` 8.21.0,
  `ajv` 8.20.0, `qs` 6.15.2, `esbuild` 0.28.1; and upgraded `turbo` to 2.9.18.
  Overrides are scoped to the vulnerable major so safe coexisting majors are
  untouched.

## [0.1.0] - 2026-06-12

First tagged release and baseline for SemVer versioning. Captures the Track A
production-readiness work and the platform foundation built so far.

### Added

- **Storage Service:**
  - Cloud-agnostic `StorageService` facade with `StorageProvider` contract
  - Drivers: S3-compatible production provider, local filesystem dev provider, in-memory test provider
  - S3 compatibility for AWS S3, Cloudflare R2, DigitalOcean Spaces, Yandex Object Storage, and Backblaze B2
  - AWS SDK checksum mode `WHEN_REQUIRED` for non-AWS compatibility
  - Public URL and signed URL support with capability checks
  - Private-by-default uploads; `UploadResult` deliberately carries no guaranteed URL
  - Object-key guard: traversal, leading slash, backslash, control chars, empty keys, and overlong keys rejected
  - `deleteMany()` S3 chunking with aggregate partial-failure exception
  - `FileValidationPipe` with magic-byte validation and presets for avatars, images, and documents
  - SVG rejected from image presets by default
  - Opt-in storage readiness check via `STORAGE_HEALTH_ENABLED`
  - App-mediated download primitive for authorized consumers
  - `POST /auth/me/avatar` and `DELETE /auth/me/avatar` public-read example consumer
  - `docs/storage/` user-facing storage guide
- **OAuth 2.0 / OIDC — Social Login & Account Linking:**
  - `openid-client` v6 (panva) — industry standard, zero transitive deps
  - **Google** provider — OIDC via discovery, PKCE (S256), ID token validation
  - **GitHub** provider — OAuth 2.0, verified primary email via `/user/emails`
  - **Apple** provider — Sign In with Apple, dynamic JWT client secret (P8 key + jose)
  - **Telegram** provider — OIDC, link-only (no email), phone number from ID token
  - Account linking: `GET /auth/oauth/:provider/link` for authenticated users
  - OAuth state + PKCE stored in Redis (TTL 5 min, one-time use, CSRF-protected)
  - Provider factory pattern: providers auto-disabled when env vars missing
  - `GET /auth/oauth/providers` — returns only configured providers
  - `OAUTH_ACCOUNT_ALREADY_LINKED` error code in shared package
  - 14 E2E tests: redirect flow, state validation, new/existing users, email matching, replay prevention
  - 23 unit tests across 5 provider files
- **Auth Documentation:**
  - `docs/auth/README.md` — overview and 30-second mental model
  - `docs/auth/concepts.md` — tokens, sessions, security model
  - `docs/auth/email-auth.md` — register, login, password reset, email verification
  - `docs/auth/sessions.md` — token rotation, session management
  - `docs/auth/oauth.md` — OAuth flows, all 4 providers, account linking
  - `docs/auth/rbac.md` — system roles, org permissions, CASL, caching
  - `docs/auth/api-keys.md` — scopes, create, revoke, security notes
  - `docs/auth/reference.md` — all endpoints, error codes, environment variables

### Added (previous unreleased)

- **RBAC (Role-Based Access Control):**
  - System roles: `USER` / `SUPER_ADMIN` stored in JWT
  - Organization-scoped permissions via CASL + DB-backed roles/permissions
  - `PermissionsCacheService` — Redis cache with `aclVersion`-based invalidation
  - `AbilityFactory` — builds CASL AppAbility with JSON condition interpolation
  - Single `AuthenticationGuard` — JWT → ApiKey → ability build in correct order
  - `@CheckPolicies()`, `@SystemRoles()`, `@Auth()` decorators
  - Organizations module: create, invite members, switch context, role management
  - Admin module: list users/orgs, promote to SUPER_ADMIN (`/admin/*`)
  - Bull Board dashboard protected with `@SystemRoles(SystemRole.SuperAdmin)`
  - Prisma seed: system roles + permissions (`pnpm db:seed`)
  - `docs/authorization.md` — user-facing authorization guide
- **Login Brute-Force Protection:**
  - `LoginRateLimiterService` — Redis-based, no external rate-limit packages
  - Per-IP: 100 failed attempts per 24 hours
  - Per-email+IP: 5 failed attempts per 1 hour → 15-minute block
  - Counters reset on successful login
- **API Key Authentication:**
  - Dual-token format: `amcore_live_{shortToken}_{longToken}`
  - `shortToken` stored in plaintext for O(1) DB lookup; `longToken` SHA-256 hashed
  - Scopes: `action:subject` format, effective = user permissions ∩ key scopes
  - Lazy `lastUsedAt` update via Redis gate (avoids hot row contention)
  - `POST/GET/DELETE /api-keys` — user manages own keys
  - `ApiKeyGuard` — parses `Authorization: Bearer amcore_live_...`, verifies, populates request.user
  - Expired API keys included in nightly `CleanupService` run
  - 15 unit tests, 7 E2E tests
- **Scheduled Tasks:**
  - `CleanupService` — nightly cron at 02:00 UTC
  - Deletes expired sessions, password reset tokens, email verification tokens, and API keys
  - `POST /admin/cleanup` — manual trigger for SUPER_ADMIN
  - Logs deleted counts per table
- **Queue Infrastructure (BullMQ):**
  - Multiple queues: `default` + `email`
  - Default job options: 3 attempts, exponential backoff, auto-cleanup
  - Bull Board dashboard at `/admin/queues`
  - `QueueService` with typed job dispatch
- **Email Service (Resend + React Email):**
  - Provider pattern: `ResendProvider` (prod) / `MockProvider` (dev/test)
  - 4 React Email templates: welcome, password-reset, email-verification, password-changed
  - FormatJS i18n (RU/EN) with ICU Message Format
  - Async dispatch via BullMQ (3 attempts, exponential backoff)
  - Two-framework testing: Jest for logic, Vitest for real template rendering
- **Redis Caching:**
  - `UserCacheService` — cache-aside, 10 min TTL, 50-100x faster auth
  - Distributed locking (stampede protection)
  - Tag-based invalidation (Redis Sets, not `KEYS *`)
  - Null caching (60 s TTL for not-found users)
- **Health Checks:**
  - `GET /health` — DB + Redis + disk + memory
  - `GET /health/startup` — DB + Redis (startup probe)
  - `GET /health/ready` — DB + Redis + disk + memory 1 GB (readiness probe)
  - `GET /health/live` — memory 1.5 GB only (liveness probe, no external deps)
  - Custom `PrismaHealthIndicator` and `RedisHealthIndicator`
- **E2E Testing Infrastructure:**
  - Testcontainers: real PostgreSQL 16 + Redis 7 per test suite
  - 5 suites: auth (42), organizations (10), admin (7), api-keys (7), oauth (14)

### Added (initial foundation)

- **Phase 0: Foundation**
  - Monorepo setup with pnpm workspaces + Turborepo
  - NestJS 10 backend with modular architecture
  - Next.js 16 frontend with App Router and React Compiler
  - PostgreSQL 16 with Prisma 6 ORM (multi-schema: core, fitness, finance, subscriptions)
  - Redis integration for caching and sessions
  - JWT authentication with refresh tokens (rotation, httpOnly cookie)
  - User registration and login endpoints
  - Session management (list, revoke, revoke all)
  - Password reset flow (forgot-password → reset-password)
  - Email verification flow (verify-email → resend-verification)
  - Rate limiting for auth operations (3/hour per email via Redis)
  - Account enumeration prevention
  - Environment variable validation with Zod (crashes fast on bad config)
  - 3-layer exception filters: `AllExceptionsFilter`, `PrismaClientExceptionFilter`, `HttpExceptionFilter`
  - Domain exceptions: `AppException`, `NotFoundException`, `ConflictException`, `BusinessRuleViolationException`
  - Structured logging with Pino: correlation ID, GDPR IP anonymization, sensitive data redaction
  - Graceful shutdown (SIGTERM/SIGINT, log flush before exit)
  - Global rate limiting (10 req/s + 100 req/min)
  - Helmet, CORS, cookie parser
  - Swagger/OpenAPI at `/docs`
  - Feature-Sliced Design (FSD) frontend architecture
  - Tailwind CSS 4 + shadcn/ui
  - Zustand for client state, TanStack Query for server state
  - Docker Compose for local development (multi-stage Dockerfile)
  - CI/CD pipeline (lint, typecheck, test, build — 4 parallel jobs)
  - Dependabot for automated dependency updates
  - ESLint + Prettier + Husky + lint-staged + commitlint

## 0.0.1 - 2026-01-27

### Added

- Initial repository setup
- Basic project structure
- README with project overview
- MIT License

---

[unreleased]: https://github.com/alex-morozov84/AMCore/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/alex-morozov84/AMCore/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/alex-morozov84/AMCore/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/alex-morozov84/AMCore/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/alex-morozov84/AMCore/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/alex-morozov84/AMCore/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/alex-morozov84/AMCore/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/alex-morozov84/AMCore/releases/tag/v0.1.0
