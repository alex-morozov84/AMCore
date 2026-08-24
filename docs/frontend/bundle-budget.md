# Bundle Baseline And Budget

`apps/web`'s per-route client bundle size, how to re-derive it, and why this
starter ships a documented baseline instead of a CI-enforced budget today.

## Method

Next 16.1+ ships `next experimental-analyze` (Turbopack-only), which reports
per-route client/server module composition. Two things about it matter before
trusting any number it produces:

- **`next.config.ts` has no `experimental.cssChunking: 'graph'`** — the
  default is `true` (whole-app CSS chunking), confirmed against the installed
  `next@16.3` docs. This matters because
  [vercel/next.js#95530](https://github.com/vercel/next.js/issues/95530)
  reports the analyzer misattributing CSS size when `cssChunking: 'graph'` is
  set. AMCore doesn't set it, so that bug doesn't apply here — re-check this
  note if `next.config.ts` ever gains a `cssChunking` override.
- **`next experimental-analyze --output` has no machine-readable _size_
  output** — verified against the installed source
  (`node_modules/next/dist/build/analyze/index.js:114`), not assumed. It
  writes `.next/diagnostics/analyze/data/routes.json` (a plain JSON route
  _list_, no sizes) plus a `modules.data` file for the interactive UI's own
  bundled reader — the per-route/per-module figures the UI displays
  ("compressed (estimated)", "uncompressed", "modules") have no JSON or CLI
  form of their own. The only way to read those specific figures is the
  interactive server (`next experimental-analyze --port <port>`, default 4000) and its browser UI.
  **This is a narrower claim than "the analyzer has no JSON output" —** see
  the next bullet, and [CI enforcement](#ci-enforcement-deferred) below for
  why this distinction matters.
- **A plain `next build` (no analyzer involved) already writes a different,
  genuinely machine-readable per-route JSON file:**
  `.next/diagnostics/route-bundle-stats.json`
  (`node_modules/next/dist/build/route-bundle-stats.js`), one row per route
  with `firstLoadUncompressedJsBytes` and the exact deduplicated chunk list
  that number is summed from. This is the closest available successor to
  the per-route "First Load JS" column `next build`'s own stdout used to
  print before Next 16.0 removed it. It is **not the same metric** as the
  analyzer's "uncompressed" figure above — the analyzer's "All Route
  Modules" scope sums every module reachable from a route without
  deduplicating shared chunks across routes, while
  `firstLoadUncompressedJsBytes` is the real deduplicated network payload
  for that route's first visit (a dashboard route showed ~1.16 MB here vs.
  the analyzer's 2.44 MB for the same route — both numbers are correct,
  they answer different questions). It also has no compressed/gzip figure
  of its own. See [CI enforcement](#ci-enforcement-deferred) for why this
  file is nonetheless the more promising path for a future CI check.

To reproduce the baseline:

```bash
# from repo root — packages/shared/dist is gitignored, so apps/web cannot
# resolve @amcore/shared on a clean checkout without this step first
pnpm --filter @amcore/shared build

cd apps/web
rm -rf .next && pnpm build            # real production build, not `next dev`
pnpm exec next experimental-analyze --port 4000   # backgrounded; serves the UI
```

Then, for each route: open `http://localhost:4000`, select the route from the
switcher, stay on the **Client** view with scope **All Route Modules**, and
read the "compressed (estimated)" / "uncompressed" / "modules" figures. This
was driven via Playwright (`@playwright/test`, already a project dependency)
rather than by hand, since the analyzer has no CLI/JSON path — see
[Non-vacuity proof](#non-vacuity-proof) for why that automation is trustworthy
for a one-off measurement but not for an unattended CI gate.

## Baseline (2026-08-25, `next@16.3`, clean `pnpm build` from a simulated clean checkout)

Per-route, not aggregate — Track 4 found an aggregate bundle metric that said
"+29%" while every individual route's transfer was flat or down, because the
aggregate was sensitive to chunk-splitting granularity, not user-facing cost.
Compare per route, never the sum.

| Route                           | Compressed (est.) | Uncompressed | Modules |
| ------------------------------- | ----------------: | -----------: | ------: |
| `/[locale]` (dashboard)         |         929.68 KB |      2.44 MB |     536 |
| `/[locale]/login`               |         868.40 KB |      2.30 MB |     475 |
| `/[locale]/register`            |         868.40 KB |      2.30 MB |     475 |
| `/[locale]/forgot-password`     |         868.41 KB |      2.30 MB |     475 |
| `/[locale]/reset-password`      |         868.41 KB |      2.30 MB |     475 |
| `/[locale]/verify-email`        |         868.41 KB |      2.30 MB |     475 |
| `/[locale]/resend-verification` |         868.41 KB |      2.30 MB |     475 |
| `/[locale]/settings/sessions`   |        1017.23 KB |      2.62 MB |     642 |
| `/[locale]/auth/callback`       |               0 B |          0 B |       0 |
| `/_not-found`                   |         218.13 KB |    596.55 KB |     157 |

`/[locale]/auth/callback` is a Route Handler with no client page, hence 0 B —
expected, not a measurement gap.

**Confirmed stable**: this table was produced identically across three
independent clean rebuilds (`rm -rf .next && pnpm build`, restarting the
analyzer each time) — byte-for-byte, including the two runs bracketing the
regression-injection proof below, plus a fourth rebuild from a genuinely
reproducible state (`rm -rf packages/shared/dist apps/web/.next`, confirmed
the build fails with a `module-not-found` error on `@amcore/shared` without
the `pnpm --filter @amcore/shared build` step above, then re-ran clean with
it) — same numbers again.

For reference, `.next/diagnostics/route-bundle-stats.json` from this same
build (see [Method](#method) for what this file is and how it differs from
the table above):

| Route                           | `firstLoadUncompressedJsBytes` |
| ------------------------------- | -----------------------------: |
| `/[locale]`                     |                      1,159,570 |
| `/[locale]/login`               |                      1,072,616 |
| `/[locale]/register`            |                      1,072,616 |
| `/[locale]/forgot-password`     |                      1,072,616 |
| `/[locale]/reset-password`      |                      1,072,616 |
| `/[locale]/verify-email`        |                      1,072,616 |
| `/[locale]/resend-verification` |                      1,072,616 |
| `/[locale]/settings/sessions`   |                      1,258,161 |
| `/_not-found`                   |                        451,702 |

(`/[locale]/auth/callback` has no row — it's a Route Handler, not a page,
so it never appears in this file either.)

## Non-vacuity proof

A baseline nobody has shown can detect a regression is not a baseline worth
trusting. To prove the method actually measures something, a real dependency
was temporarily added to `ForgotPasswordForm.tsx` (an unused
`@tanstack/react-table` import — already a project dependency, so this
exercises real module-graph attribution rather than adding a new package),
the app rebuilt clean, and the analyzer re-run:

| Route                         |     Before |      After |            Delta |
| ----------------------------- | ---------: | ---------: | ---------------: |
| `/[locale]/forgot-password`   |  868.41 KB |  897.19 KB |        +28.78 KB |
| `/[locale]/login`             |  868.40 KB |  897.17 KB |        +28.77 KB |
| `/[locale]/settings/sessions` | 1017.23 KB | 1018.26 KB | +1.03 KB (noise) |
| `/[locale]` (dashboard)       |  929.68 KB |  929.67 KB | −0.01 KB (noise) |

Two things worth noting, not just the pass/fail:

- The regression leaked into `/[locale]/login` too, even though only
  `ForgotPasswordForm.tsx` changed — both routes share the `(auth)` route
  group's client chunk, so a change to one auth-form component's imports can
  move another auth route's number. A route-level budget needs to account for
  shared-chunk attribution, not assume routes are independent.
  `/[locale]/settings/sessions` and the dashboard, outside that route group,
  correctly stayed flat (the ±1 KB is measurement noise, not the injected
  dependency).
- The injection was then reverted (`git diff` clean) and the app rebuilt
  clean a third time; all ten routes returned to the exact original baseline
  numbers above, closing the loop: the method detects a real regression,
  attributes it to the right scope, and correctly reports a return to
  baseline once removed.

## CI enforcement: deferred

The instruction going into this baseline work was: only add a CI-enforced
bundle budget if the method proves stable, useful, and non-vacuous via a real
regression injection; otherwise record the baseline and defer enforcement.

The measurement data cleared all three bars above. What's **not** proven is
that the _extraction method used for this table_ is fit for unattended CI,
and that's a separate question from whether the numbers themselves are
trustworthy:

- The baseline table above was produced by scripted Playwright automation
  that clicks the analyzer's route switcher by hardcoded pixel coordinates
  and scrapes result numbers by matching DOM text labels
  (`"compressed (estimated)"`, etc.) — the only way to read those specific
  figures out, since `next experimental-analyze` has no JSON/CLI form of
  them (see [Method](#method)). That's a reasonable one-off technique for a
  human-supervised baseline refresh, but it's scraping the internal DOM of a
  command explicitly labeled `experimental` (shipped `v16.1.0` — CLI
  reference table, `next.md`), with no compatibility guarantee across Next
  minors. A CI gate built on it would either need to re-verify its DOM
  assumptions on every Next upgrade or silently start reporting wrong
  numbers — worse than no gate at all, since a wrong-but-green gate is
  trusted. Running a real browser plus a long-lived analyzer server also adds
  real CI time and a new flakiness surface (port binding, browser launch,
  coordinate/timing races).
- **`route-bundle-stats.json` (see [Method](#method) and the reference table
  above) does not have this problem** — it's a plain JSON file, one row per
  route, written by an ordinary `next build` with zero extra tooling and no
  interactive UI involved. It measures a different thing than the table
  above (deduplicated first-load JS bytes, uncompressed only, not the
  analyzer's whole-module-graph "compressed (estimated)" figure), but that
  metric is a legitimate, arguably more directly user-relevant bundle-budget
  signal on its own, and a CI script could parse it and diff per-route
  `firstLoadUncompressedJsBytes` against a committed baseline with no
  browser automation at all.

So: baseline recorded here (re-derivable via [Method](#method) above,
confirmed stable/non-vacuous), CI enforcement **not** added in this PR.
**Reopening condition, self-contained:** build a CI check against
`route-bundle-stats.json` instead of the analyzer UI — this removes the
fragility objection above entirely, since it needs no browser automation and
no dependence on an `experimental`-labeled command's internal DOM. That
check would still need its own non-vacuity proof (a real regression
injection against `route-bundle-stats.json` specifically, not reused from
this doc's analyzer-based proof) before being trusted as a merge gate, per
this repo's standing rule that a new guard owes a hand proof-fail. Not
started here — a deliberate scope decision for a separate PR, not a
technical blocker.

## Re-deriving this later

1. `pnpm --filter @amcore/shared build` (from repo root — required on a
   clean checkout, see [Method](#method))
2. `cd apps/web && rm -rf .next && pnpm build`
3. For the deduplicated first-load JS numbers with no extra tooling, read
   `.next/diagnostics/route-bundle-stats.json` directly.
4. For the analyzer's compressed/uncompressed/module-count figures, run
   `pnpm exec next experimental-analyze --port 4000` (backgrounded), open
   `http://localhost:4000`, select each route from the switcher, stay on
   **Client** / **All Route Modules**, and read the three figures.
5. Compare per route against the tables above — a route moving by more than
   a few KB with no corresponding feature change is worth investigating
   before merge, even without an automated gate.

## See also

- [Testing](./testing.md) — the rest of the frontend verification loop this
  baseline sits alongside.
