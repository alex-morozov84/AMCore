# Storybook

`apps/web`'s component workshop (Track 8, **ADR-070**): a state catalog for
`shared/ui` and key starter flows, wired into the same decorator/mocking
stack the real app uses, with an automated accessibility gate riding on it.
This page is the operating guide — what's wired, how to write a story, and
the two procedural rules this track's own implementation needed twice.

## What's wired

`@storybook/nextjs-vite` (the Vite-based Next.js framework, not the
webpack-based `@storybook/nextjs` — chosen because Vite is already this
repo's Vitest builder and only the Vite framework gets first-class
`@storybook/addon-vitest` support), with:

- **`@storybook/addon-a11y` + `@storybook/addon-vitest`** — every story
  becomes a Vitest test (a smoke render, plus any `play` function's
  assertions), with `addon-a11y`'s axe checks running inside the same run.
  See [Accessibility gate](#accessibility-gate-and-how-it-relates-to-the-testing-pyramid)
  below.
- **`@storybook/addon-themes`**'s `withThemeByClassName` — toggles `.dark`
  on the story root, the same mechanism `shared/lib/theme.ts`'s
  `applyTheme()` uses. The real app `ThemeProvider` is **not** wrapped
  globally in `.storybook/preview.tsx` — it reads `localStorage` via its own
  effect and would fight the toolbar's class on every switch. Add a
  targeted wrapper only when a story actually imports a component that
  calls `useTheme()` (none do today — checked with
  `rg -n "useTheme\(" apps/web/src` before writing this line, not assumed).
- **`msw-storybook-addon`** — reuses `apps/web/src/test/msw/handlers.ts` as
  the base handler set (the same `msw` `http.*` handler objects the Vitest
  integration layer uses — `setupServer()`/`setupWorker()` only differ in
  entry point). Global handlers and per-story overrides both use the
  addon's current API:

  ```ts
  // .storybook/preview.tsx — global
  beforeEach({ msw }) {
    msw.use(...handlers)
  }

  // a story — per-story override
  export const SomeState: Story = {
    beforeEach({ msw }) {
      msw.use(http.get('/api/...', () => HttpResponse.json({ ... })))
    },
  }
  ```

  Not `parameters.msw.handlers` — that shape is deprecated in the installed
  addon version. Re-check the addon's own README (`node_modules/msw-storybook-addon/README.md`)
  before assuming this is still current on a future upgrade.

- A fresh `QueryClient` **per story render** (not the app's shared
  `getQueryClient()` singleton) so one story's cache never bleeds into the
  next in the same browser session; a manual `NextIntlClientProvider`
  (see [i18n & errors](./i18n-and-errors.md)) rather than a community
  locale-switcher addon — no such addon's maintenance status has been
  independently verified, and the manual decorator is a few lines. There is
  no global Zustand provider — `UIStoreProvider` was removed in Track 9 once
  shadcn's `Sidebar` took over the one piece of state it held; add a
  provider back here if a future Zustand store needs one.
- `parameters.nextjs.appDirectory: true` globally — every real component
  here lives under `app/[locale]`. `experimentalRSC` is **not** enabled —
  React Server Component support in `@storybook/nextjs-vite` is explicitly
  experimental, and route-level `async` Server Component compositions
  (`requireSession()`-gated pages) stay owned by the real-stack Playwright
  lane per [Testing](./testing.md) — nothing else can prove that boundary.
  Don't story a `_pages/*Page` composition here; story its client-side
  `features/*`/`shared/ui` pieces instead.
- `core.disableTelemetry: true` — a starter shouldn't phone home for
  downstream forks by default.

**Deliberately out of scope**: the React Compiler (`babel-plugin-react-compiler`,
wired through Next's own build pipeline via `next.config.ts`'s
`reactCompiler: true`) is not wired into Storybook's Vite builder. It's a
build-time memoization optimization, not a story-level correctness concern,
and Storybook's Vite pipeline is separate from Next's build pipeline
entirely — `apps/web`'s own `next build`/`next dev` already prove the
compiler works.

## Story scope and placement

Story files are **co-located** next to source (`button.stories.tsx` beside
`button.tsx`), matching the existing `*.test.tsx` convention — no separate
`stories/` tree. Current coverage:

- All 19 `shared/ui` primitives, including `sidebar.tsx`/`sheet.tsx`/
  `tooltip.tsx`/`separator.tsx` (added Track 9 for the dashboard app shell).
- Seven feature-flow references:
  `features/auth-login/ui/LoginForm`,
  `features/auth-register/ui/RegisterForm`,
  `features/auth-forgot-password/ui/ForgotPasswordForm`,
  `features/auth-reset-password/ui/ResetPasswordForm`,
  `features/auth-verify-email/ui/VerifyEmailStatus`,
  `features/auth-resend-verification/ui/ResendVerificationForm`, and
  `features/sessions-revoke/ui/RevokeSessionMenuItem` — the sessions story is
  the reference for the real toast/mutation/query-invalidation pattern
  (Track 6), while the auth email-link stories are the reference for
  enumeration-safe public-auth actions that don't mint a session.

Not storied, and not an oversight: `entities/*` UI (thin/hook-heavy right
now), any dashboard/settings page-level composition, `widgets/app-shell`
itself (a real-auth/locale/logout composition — `sidebar.stories.tsx`
demonstrates the underlying primitive with stand-in nav items instead, same
split as `_pages/*Page` below), and any
`_pages/*Page` route composition (Server-Component-owned, see above).

Write stories in **CSF3**, not CSF Factories (`defineConfig`-style) — CSF
Factories are Preview status in the installed Storybook major and not
stable before Storybook 11; CSF3 stays supported long-term and is what
every existing story in this repo uses.

**Drive real interaction, don't just render a static prop combination
where the real component has meaningful behavior.** A dialog/menu story
should open via a `play` function clicking the real trigger (`userEvent`
from `storybook/test`), not `defaultOpen` — a `defaultOpen` dropdown-menu
story hit a real axe `aria-hidden-focus` violation on Base UI's internal
focus-guard sentinels that a click-triggered open avoided entirely (Menu
-specific; `Dialog`/`AlertDialog`'s own `defaultOpen` stories never hit
this — confirmed live, not assumed to generalize). A component driving a
real mutation (a form, a menu action) should hit the real BFF endpoint
through a mocked `msw` handler and assert on the real rendered outcome, the
same way `LoginForm.stories.tsx`'s `InvalidCredentials` story asserts the
real translated error text rather than just asserting the component
rendered.

## Accessibility gate, and how it relates to the testing pyramid

`parameters.a11y.test: 'error'` (`.storybook/preview.tsx`) is a **CI-gating
default** — a violation fails `pnpm test:storybook` and the `storybook` CI
job, the same way any other gate does. In AMCore upstream strict mode this is
mandatory, not an optional local workshop. This is genuinely a fifth layer of
[Testing](./testing.md)'s pyramid, not a side tool: add or extend a story
here when a **`shared/ui` primitive or its isolated states** change: see
that guide's "Which layer should I add a test at?" section. It complements,
not replaces, the full-page `@axe-core/playwright` scans already in the
E2E lanes — isolated-component-state coverage and assembled-page coverage
catch different things, and Storybook's own default ruleset disables the
`region` rule specifically to avoid false positives at component-isolation
granularity that wouldn't apply to a full page.

A per-story `'todo'` override is for a real, tracked gap — not a way to
silence a violation you haven't investigated.

## Two procedural rules, both paid for during this track

### The setup/upgrade CLI is not safe against the live tree

`npm create storybook@latest` (initial setup) and `npx storybook upgrade`
(future version bumps) both run **only in a disposable scratch worktree**,
never directly against the live repo — the same procedure
[Shared UI & shadcn](./shared-ui-and-shadcn.md) already established for the
`shadcn` CLI, for the same reason: this track's own setup spike found the
wizard silently reformatting `eslint.config.mjs` wholesale (not just adding
its own lines) and pinning several dependencies to the literal string
`"latest"` — never acceptable in this repo.

```bash
git worktree add ../amcore-<task>-spike -b spike/<task> main
cd ../amcore-<task>-spike/apps/web && pnpm install --frozen-lockfile
# run the CLI here, inspect the real diff, decide what to hand-port
cd /path/to/AMCore && git worktree remove ../amcore-<task>-spike --force
git branch -D spike/<task>
```

Hand-port only what you decided to keep, preserving existing formatting
and pins. **Patch/minor version bumps** don't need the CLI at all — they go
through this repo's normal dependency-bump PR, the same lane as any other
`^`-pinned devDependency update. **Major version upgrades** get the full
scratch-worktree procedure above: run `npx storybook upgrade` there, diff
it against the live config, hand-port the real changes, never accept a
codemod's output verbatim.

### `vitest.config.ts`'s `optimizeDeps.include` (storybook project) is reactive, never preemptive

Vitest's browser mode occasionally needs a package explicitly listed in
`optimizeDeps.include` to pre-bundle it correctly — a real, cold-run-only
failure this track proved in two places: `path-to-regexp` (a transitive
`msw` dependency with a monorepo-resolution wrinkle of its own) and PR4's
first real component-story tranche (`@base-ui/react/button`,
`@hookform/resolvers/zod`, `@radix-ui/react-slot`,
`class-variance-authority`, `lucide-react`, `react-hook-form`). **Do not add
an entry here because a new story tranche merely introduces a new
dependency** — adding a component or story on its own never requires touching
this file. A version of this rule that looked plausible but wasn't checked
live shipped once during this track's own PR5 and was caught in diff review:
removing the unproven entries and clearing caches still passed clean, twice.

The only valid reason to add an entry:

1. **Reproduce a real failure on a genuinely cold cache**:
   ```bash
   rm -rf apps/web/node_modules/.vite apps/web/node_modules/.cache/storybook
   pnpm --filter web test:storybook
   ```
   "Vite unexpectedly reloaded a test" or a missing-named-export error on
   this exact command is the real signal — not a hunch, not "the last
   tranche needed one so this one probably will too."
2. Add the **minimal, specific** package(s) Vite's own error message names.
3. **Prove the fix** by re-running the same cold-cache command and
   confirming a clean pass — ideally twice.

A diff review touching `optimizeDeps.include` should always ask: "why is
this dependency here, and where's the negative proof it actually failed
without it?" CI cannot catch an unnecessary, preemptive entry the way it
catches a missing one — it just silently sits there as debt.

## Downstream: disabling Storybook

A downstream product that does not want the component-workshop surface
should **remove** it rather than leave it present but unused.
`pnpm init:project --storybook=disabled` automates this — a one-time,
destructive transform; see its own `--dry-run` output and **ADR-071** for
the safety model. It works alone, or together with
`--mode=single --locale=<code>` in one invocation. It does:

1. Delete `.storybook/` and every co-located `*.stories.tsx` file.
2. Remove Storybook's scripts and devDependencies from
   `apps/web/package.json`, the Storybook plugin/rules block from
   `eslint.config.mjs`, and the `storybook` project from `vitest.config.ts`.
3. Remove the CI `storybook` job (`.github/workflows/ci.yml`) and its
   Dependency Review allowlist entry (`.github/workflows/dependency-review.yml`),
   both anchored by `amcore:sentinel-block` marker comments added ahead of
   time for exactly this.
4. Delete this page and every other Storybook-specific public doc
   reference, and update `PROJECT_CONTEXT.md`'s `frontend_storybook` field
   and its descriptive bullet to a self-contained "disabled" description.

Because removing `apps/web/package.json` dependencies leaves
`pnpm-lock.yaml` stale the instant apply writes, automated post-apply
verification is skipped for this dimension — the command prints a manual
follow-up (`pnpm install`, then `pnpm typecheck && pnpm lint && pnpm
--filter web build && pnpm --filter api test && pnpm --filter web test`)
instead of running it for you.

## Commands

| Command                             | What it runs                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter web storybook`       | Dev server, `http://localhost:6006`                                                                            |
| `pnpm --filter web build-storybook` | Static build (`storybook-static/`) — cheap compile/broken-story smoke                                          |
| `pnpm --filter web test:storybook`  | Every story as a Vitest test, browser mode (Playwright Chromium), a11y gate included                           |
| `pnpm --filter web test:run`        | Unit/integration suite only (`--project=unit`) — the `storybook` Vitest project stays out of the default suite |

CI runs `build-storybook` then `test:storybook` in a dedicated `storybook`
job (`.github/workflows/ci.yml`), separate from `web-e2e` — no
Docker/Postgres/Redis needed since every story's API surface is mocked.

## See also

- [Shared UI & shadcn](./shared-ui-and-shadcn.md) — the `shared/ui`
  inventory these stories catalog, and the shadcn-CLI safety procedure this
  page's own CLI-safety section mirrors.
- [Testing](./testing.md) — the full pyramid this gate is a layer of, and
  "Which layer should I add a test at?" for routing a new test correctly.
- [i18n & errors](./i18n-and-errors.md) — the `NextIntlClientProvider`
  decorator pattern.
- **ADR-070** (`ai/decisions/adr-070-storybook-component-workshop.md`) —
  the full decision record.
