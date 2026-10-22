# Route bundle budgets

Every web page has a limit on its first-load JavaScript. CI fails a change that
pushes a page over its limit, so bundle growth is a reviewed decision instead of
a slow drift.

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
build, in the same checkout. CI does exactly this in the **Build** job and after
every web build of the generated scaffold variants.

Each line shows the page key, its bytes, its limit and its gzip size:

```text
ok   app:/login            996123 /     1045930  gzip 315762
OVER app:/register        1074315 /     1045930  gzip 339108
```

The header names the source commit (with `(dirty)` for uncommitted changes), the
lockfile hash, the build ID and the stats file hash. Use them to tell which build a
report describes; the check itself cannot prove the build matches the source.

## When a page is over budget

1. Find what grew. Run `pnpm exec next analyze --output --snapshot before` on the
   base branch and `--snapshot after` on yours from `apps/web`, then compare
   `pnpm exec next analyze export --snapshot <name> --route '/[locale]/login'`.
   The export is JSON Lines with each module's size and import chain.
2. Prefer removing the cost: import a smaller module, move work to a Server
   Component, or load an independent feature lazily.
3. If the growth is intended, raise the limit in the budget file in the same pull
   request and say why in its description.

## Budget files

Rows live in `apps/web/route-budgets.json`. A feature that owns a closed directory
can keep its rows in its own `route-budgets.json` there: the check reads every
`apps/web/src/**/route-budgets.json` as well.

A row key is `scope:/path`. The check removes the `[locale]` segment, so one key
serves multi- and single-locale projects. A scope claims the pages under its
physical route prefix; `product-admin` uses the alias from
`packages/shared/src/config/product-admin.json`. Other pages use `app`. For
example `/[locale]/manage/organizations` is `product-admin:/organizations`.

A value is a positive byte limit or `"report-only"` (measured and checked, but
without a limit). These pages must have a byte limit: `app:/`, `app:/login`,
`app:/register`, `app:/settings/sessions` and `product-admin:/organizations`.

<!-- AMCORE_CONSOLE_ROUTE_BUDGETS_DOC_START -->

The Operations Console keeps its rows in
`apps/web/src/_pages/console/route-budgets.json`. Its scope `admin-console`
claims the pages under the slug in
`apps/web/src/shared/lib/admin-console.generated.ts`, and `admin-console:/` must
have a byte limit.

<!-- AMCORE_CONSOLE_ROUTE_BUDGETS_DOC_END -->

To set a limit, take the page's current bytes from the check output and add
5 % or 15 KiB (15,360 bytes), whichever is larger. Lowering a limit after an
optimization keeps the gain; record that choice in the pull request too.

## What else fails the check

The stats file is an internal Next diagnostic, and Next skips missing chunk files
silently when it sums a row. The check therefore also fails when:

- the stats file, the route manifest or the build ID is missing or malformed;
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

`scripts/lib/route-budget-inputs.mjs` lists the Next versions whose stats format
was checked (`SUPPORTED_NEXT`). After an upgrade the check stops with an
unsupported-version message. Read the installed
`node_modules/next/dist/build/route-bundle-stats.js`, confirm the row fields and
the excluded routes in `filterAndSortList` have not changed, then widen the
pattern. Run `node --test scripts/lib/route-budgets.test.mjs` afterwards.
