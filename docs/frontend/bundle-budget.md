# Route bundle budgets

Every web page has a limit on its first-load JavaScript. CI fails a change that
pushes a page over its limit, so bundle growth is a reviewed decision instead of
a slow drift.

[Lighthouse audits](./testing.md#lighthouse-audits) separately inspect loaded-page defects. Their route coverage does not replace these JavaScript byte limits.

## What is measured

`next build` writes `apps/web/.next/diagnostics/route-bundle-stats.json`: one row
per page with `firstLoadUncompressedJsBytes`, the deduplicated raw size of the
JavaScript a first visit to that page downloads, and the chunk files it sums.

The budget is per page, never a total: shared chunks move between routes when
the bundler splits code differently, so a total can grow while every page shrinks.
Sizes are raw bytes. The check also prints gzip sizes for information.

The budget covers JavaScript only. HTML, the RSC payload, CSS and fonts are not
included. The translation payload in HTML has its own check, described in
[i18n and error localization](./i18n-and-errors.md#which-messages-reach-the-browser).

## Run the check

```bash
pnpm build                    # or: pnpm exec turbo run build --filter=@amcore/web
pnpm check:route-budgets
```

The check reads the build output and never builds. Run it right after the web
build, in the same checkout. CI does exactly this in the **Build** job.

Each line shows the page key, its bytes, its limit and its gzip size:

```text
ok   app:/login            996123 /     1045930  gzip 315762
OVER app:/register        1074315 /     1045930  gzip 339108
```

The header names the source commit as it is when the check runs (with `(dirty)`
for uncommitted changes), the lockfile hash, the build ID and the stats file hash.
Use them to identify a saved report. They cannot show that the build is stale:
the check never compares the build with the source. A pass proves the current
source only when the web build ran first in the same checkout. After a source
change, build again before you run the check.

## When a page is over budget

1. Find what grew. `next analyze` runs its own analysis build of the current
   checkout and saves a named snapshot under `.next/diagnostics/analyze`. A later
   `next build` keeps it. In `apps/web`, run:

   ```bash
   # base branch checked out, then: pnpm install
   pnpm exec next analyze --output --snapshot before
   # your branch checked out, then: pnpm install
   pnpm exec next analyze --output --snapshot after
   pnpm exec next analyze export --snapshot before --route '/[locale]/login' > before.jsonl
   pnpm exec next analyze export --snapshot after --route '/[locale]/login' > after.jsonl
   ```

   Each export line is one JSON record. Compare the `size` of the records per
   `source_path` in the two files to find the new or larger modules. To see why a
   module is included, run `pnpm exec next analyze` without `--output`: it serves
   a browser view with each module's import chain.

2. Prefer removing the cost: import a smaller module, move work to a Server
   Component, or load an independent feature lazily.
3. If the growth is intended, raise the limit in the budget file in the same pull
   request and say why in its description. The budget file has no per-row
   comments, so the pull request description is the record of the reason. The
   reviewer decides whether the reason justifies the growth or asks for step 2.

## Budget files

Rows live in `apps/web/route-budgets.json`, product administration rows included.
A feature that owns a closed directory can keep its rows in its own
`route-budgets.json` there: the check reads every
`apps/web/src/**/route-budgets.json` as well. Every file has this shape:

```json
{
  "routes": {
    "app:/login": 1045930,
    "product-admin:/organizations": 1620216
  }
}
```

A row key is `scope:/path`. The check removes the `[locale]` segment, so one key
serves multi- and single-locale projects. A scope claims the pages under its
physical route prefix; `product-admin` uses the alias from
`packages/shared/src/config/product-admin.json`. Other pages use `app`. For
example `/[locale]/manage/organizations` is `product-admin:/organizations`.

A value is a positive byte limit or `"report-only"` (measured and checked, but
without a limit). Give every page a byte limit. Use `"report-only"` only for a page
whose JavaScript depends on the project choices, and say why in the pull request.
`app:/_not-found` is the one current case: with locale routing it carries only the
Next runtime, and in a single-locale project it also carries the root layout's
client code, which the limits of all other pages already cover. These pages must
have a byte limit: `app:/`, `app:/login`, `app:/register`, `app:/settings/sessions`
and `product-admin:/organizations`.

The Operations Console keeps its rows in
`apps/web/src/_pages/console/route-budgets.json`. Its scope `admin-console`
claims the pages under the slug in
`apps/web/src/shared/lib/admin-console.generated.ts`, and `admin-console:/` must
have a byte limit.

To set a limit, take the page's current bytes from the check output and add
5 % of those bytes or 15 KiB (15,360 bytes), whichever is larger. Round the
result up to a whole byte: `996123` bytes give `1045930`. A new page has no row yet, so the check fails with
`has no budget row`. It still prints the page's bytes, with `none` as the limit.
Add the row with the computed limit and run the check again.

Lowering a limit after an optimization keeps the gain. Say so in the pull request
description, as for a raised limit.

## What else fails the check

The stats file is an internal Next diagnostic, and Next skips missing chunk files
silently when it sums a row. The check therefore also fails when:

- the stats file or the route manifest is missing or is not valid JSON;
- the `BUILD_ID` file is missing or empty;
- the installed Next version is not one whose stats format was verified;
- a page in `app-path-routes-manifest.json` is missing from the stats, or the
  stats list a route the manifest does not (Route Handlers and Next's own
  `/_global-error` and `/favicon.ico` are not pages and need no row);
- a chunk is missing, repeated, not `.js`, outside `.next/static`, or the chunk
  files do not add up to the recorded size;
- two pages map to one key, or two scopes claim one page;
- a built page has no row, a row names no built page, a row uses an unknown scope,
  or one key appears in two budget files.

## Upgrading Next

`SUPPORTED_NEXT` in `scripts/lib/route-budget-inputs.mjs` is a regular expression
for the Next versions whose stats format was checked, for example
`/^16\.4\.\d+$/`. After an upgrade the check stops with an unsupported-version
message.

1. Read the installed `apps/web/node_modules/next/dist/build/route-bundle-stats.js`.
   Confirm that a row still has the fields `route`, `firstLoadUncompressedJsBytes`
   and `firstLoadChunkPaths`. Confirm that `filterAndSortList` still leaves out
   exactly the routes in `STATS_EXCLUDED_ROUTES` in `route-budget-inputs.mjs`.
2. If they are unchanged, widen `SUPPORTED_NEXT` by the verified minor version
   only, for example `/^16\.(4|5)\.\d+$/`. Do not accept versions nobody checked.
3. If they changed, update the readers in `route-budget-inputs.mjs` and the fixture
   in `scripts/lib/route-budgets-fixture.mjs` to the new format first.
4. In `scripts/lib/route-budgets.test.mjs`, the unsupported-version test writes a
   version that must stay outside the pattern. If the new pattern accepts it,
   change it to the next minor version that nobody has checked.
5. Run `node --test scripts/lib/route-budgets.test.mjs`, then build the web app and
   run `pnpm check:route-budgets`.
