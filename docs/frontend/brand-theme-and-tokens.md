# Brand, Theme, and Design Tokens

How `apps/web`'s color/design-token system works, why it's built the way it
is, and what a downstream product replaces when it rebrands. Pairs with
[Architecture & conventions](./architecture-and-conventions.md) — that guide
covers layers and routing, this one covers the visual/token layer.

## Token architecture

`apps/web/src/app/globals.css` defines two layers of CSS custom properties:

1. **`:root`** (light — the CSS-only, no-JS baseline) and **`.dark`** (dark
   overrides) hold the actual color values.
2. **`@theme inline`** bridges those custom properties into Tailwind v4
   utilities (`bg-background`, `text-foreground`, etc.), following shadcn's
   documented CSS-variable theming convention.

`@custom-variant dark (&:where(.dark, .dark *));` makes Tailwind's `dark:`
prefix follow the `.dark` class (toggled by the app's own theme switch), not
the browser's `prefers-color-scheme` media query directly — that's what lets
a user override their OS preference.

### Token set

| Group             | Tokens                                                                                            | Notes                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Core surfaces     | `background`, `foreground`, `card`, `popover`, `surface-elevated`, `surface-sunken`               | `surface-elevated` sits visually above `background` (e.g. a raised panel); `surface-sunken` recedes (e.g. a well/input background) |
| Foreground steps  | `foreground-soft`, `foreground-muted`, `foreground-faint`                                         | Decreasing emphasis, for secondary/tertiary text                                                                                   |
| Borders           | `border`, `line-soft`, `line-strong`                                                              | `border` is the shadcn-standard name; `line-*` are AMCore's extension for finer control                                            |
| shadcn components | `primary`, `secondary`, `accent`, `muted`, `destructive`, `input`, `ring` (+ `-foreground` pairs) | `accent` is a **hover surface** (used by ghost/outline button variants), not the brand color — don't confuse it with `primary`     |
| Status            | `success`, `warning`, `info`, `danger` (+ `-soft` background pairs)                               | See [Contrast](#contrast) for why the shade differs from the "obvious" bright version                                              |
| Charts / sidebar  | `chart-1`..`chart-5`, `sidebar-*`                                                                 | Distinguishable hues independent of `primary` — a chart shouldn't visually imply "this series is the brand"                        |

**The default palette is neutral (shadcn gray), not a brand color.** `primary`/
`accent`/`ring` are neutral grays, not the AM logo's violet — the token
_system_ stays swap-first for downstream forks even though the default logo
(below) is AMCore-specific. A colored brand mark over neutral UI chrome is a
deliberate, common pattern, not an inconsistency.

**Colors are hex, not OKLCH**, unlike shadcn's newest default scaffold. WCAG
contrast math is defined over sRGB; hex keeps the contrast check below
dependency-free. This is a starter-priorities trade-off (verifiable and
owned over matching the newest upstream scaffold cosmetically), not an
oversight.

## Light / dark / system modes

Default is **`system`**: the resolved theme follows the OS preference unless
the user has explicitly picked one. A downstream product that doesn't want a
toggle can force `light` or `dark` as the fixed setting instead — see the
[rebrand checklist](#downstream-rebrand-checklist).

AMCore's default persistence model is **static-friendly client persistence**:
the browser stores the user's choice in `localStorage`, the pre-hydration script
applies the class before visible content, and Server Components do not need to
read a theme cookie. A downstream product may deliberately switch to a
**cookie-backed SSR initial theme** when it wants the server-rendered `<html>` to
already include the selected theme; see
[Cookie-backed SSR theme](#cookie-backed-ssr-theme-advanced-variant).

```
ThemeSetting  = 'light' | 'dark' | 'system'   — what the user (or the product) chose
ResolvedTheme = 'light' | 'dark'              — what's actually applied to the DOM
```

`apps/web/src/shared/lib/theme.ts` owns this: `resolveTheme(setting,
prefersDark)`, `applyTheme(resolved)`, storage helpers, and
`getThemeInitScript()` (below). `apps/web/src/shared/store/providers/ThemeProvider.tsx`
exposes it to React via `useTheme()` (`setting`, `resolvedTheme`, `setTheme`).

## Why a hand-rolled module, not `next-themes`

The obvious library choice for this problem was evaluated and rejected —
`next-themes` currently carries confirmed, open compatibility risk for this
starter's React 19 / Next 16 baseline:

- [`pacocoursey/next-themes#367`](https://github.com/pacocoursey/next-themes/issues/367)
  tracks React 19 TypeScript incompatibility.
- [`pacocoursey/next-themes#375`](https://github.com/pacocoursey/next-themes/issues/375)
  tracks stale theme state under Next/React suspend-resume behavior.
- [`pacocoursey/next-themes#369`](https://github.com/pacocoursey/next-themes/issues/369)
  and
  [`#370`](https://github.com/pacocoursey/next-themes/issues/370) track
  production minification breakage.
- [`pacocoursey/next-themes#385`](https://github.com/pacocoursey/next-themes/issues/385)
  and
  [`#387`](https://github.com/pacocoursey/next-themes/issues/387) track React 19
  warnings around the library's script-tag pattern.

The primitive itself isn't complicated enough to justify the dependency
risk: Tailwind's own dark-mode documentation describes the exact mechanism
needed directly (class toggle + `localStorage` + `matchMedia`), and React's
`useSyncExternalStore` (not a manual `useState`/`useEffect` pair) is the
correct primitive for "read a browser API that can differ between server and
client" — see `ThemeProvider.tsx`'s implementation.

## No-flash: the pre-hydration script

`app/layout.tsx` renders a **raw `<script dangerouslySetInnerHTML={{ __html:
getThemeInitScript() }} />`** as the first thing inside `<body>` — deliberately
_not_ `next/script`. This looks unusual (it bypasses a built-in Next.js
primitive that exists for exactly this "load a script" job) and is worth
justifying explicitly rather than leaving future readers to wonder if it's a
workaround:

- **`next/script strategy="beforeInteractive"` does not actually run before
  first paint** — verified by reading Next's own client bootstrap source
  (`next/dist/esm/client/app-bootstrap.js`, current as of Next 16.2.11): it
  registers the script via `self.__next_s.push(...)`, and a separate function
  (`loadScriptsInSequence`) creates the real `<script>` element and injects it
  — but that function only runs once Next's own client bootstrap chunk has
  loaded, and that chunk is fetched with `async`, i.e. _after_ the browser may
  already have painted the initial HTML. "Before hydration" (what
  `beforeInteractive` actually guarantees) is a real but weaker guarantee than
  "before paint." Confirmed empirically too: a production build's raw HTML
  response shows the script content wrapped in `self.__next_s.push(...)`, not
  as a literal executable `<script>` tag.
- **A raw inline `<script>` tag has no such gap.** The browser executes it
  synchronously as it parses the document — nothing after it in the DOM can
  paint until it finishes. This is also independently corroborated by several
  unrelated write-ups of this exact problem (Next.js App Router + Tailwind
  dark mode), not just this project's own source-reading.
- **This does knowingly go against a real, if opt-in, Vercel best practice.**
  Vercel's Conformance tooling has a rule, `NEXTJS_USE_NEXT_SCRIPT`
  (disabled by default), that specifically flags raw
  `dangerouslySetInnerHTML` script tags in favor of `next/script` — for good
  general reasons (script deduplication, loading-priority optimization) that
  don't apply to a single, tiny, synchronous, no-external-resource script
  whose entire job is "run before anything else." Treat this file as a
  deliberate, documented exception if that rule is ever enabled repo-wide,
  not an oversight to "fix" back to `next/script`.
- **`dangerouslySetInnerHTML` is safe here specifically because the content
  has no external input.** `getThemeInitScript()` is a pure function of two
  hardcoded string constants (`THEME_STORAGE_KEY`, `DEFAULT_THEME_SETTING`) —
  no props, no request data, nothing user-controlled. The API's "dangerous"
  framing is about untrusted content, which this isn't.

`<html suppressHydrationWarning>` is required and correct here: the script
legitimately changes `<html>`'s class before React hydrates, so its
class attribute will differ from what the server rendered. That's expected,
not a bug.

**One caveat for anything that renders differently by theme** (e.g. a
toggle's sun/moon icon): `ThemeProvider`'s `resolvedTheme` assumes the
SSR-safe default on the very first render (matching the server, so React
hydration itself never mismatches) and corrects to the real value
immediately after mount. Page _styling_ never flashes (the script already
applied it before paint), but a component that branches its _rendered
content_ on `resolvedTheme` will render once with the SSR assumption, then
immediately re-render with the real value. If you build that kind of
component, this one extra render is expected — don't try to "fix" it by
reading the DOM directly in `useState`'s initializer, which reintroduces a
real React hydration-mismatch warning instead.

**AMCore ships a real CSP by default** (Track 3, ADR-074) — this script
already receives the per-request nonce `src/proxy.ts` generates
(`app/[locale]/layout.tsx`'s `<script nonce={nonce}>`), never
`unsafe-inline`. See
[Browser security headers and CSP](./browser-security-and-csp.md) for the
full policy, enforcement mode, and how to extend it.

## Cookie-backed SSR theme (advanced variant)

AMCore does **not** ship two live theme implementations. The starter ships one
clean default implementation and documents this cookie-backed variant for
downstream products that consciously want it.

Choose the default `localStorage` strategy when:

- the product wants to preserve static rendering and CDN/cache friendliness;
- the server does not need to know the user's selected theme;
- a one-render correction for theme-dependent icons/labels after hydration is
  acceptable;
- `system` mode should work without extra middleware or Client Hints.

Choose a cookie-backed SSR theme when:

- the server-rendered `<html>` must contain the selected theme class/style;
- theme-dependent server-rendered UI must be correct on the first React render;
- the product already accepts request-dependent rendering for personalization;
- the team accepts the extra implementation and testing surface.

The trade-off is architectural, not cosmetic: in Next.js App Router,
`cookies()` is a Dynamic API. Reading it in a layout or page makes that route
request-dependent. If it is read in the root layout, the whole app's root
segment now depends on the incoming request. That can be the right choice for a
product, but it is too strong as AMCore's universal default.

A cookie-backed variant normally changes ownership like this:

1. `app/layout.tsx` reads `cookies()` and derives `initialTheme`.
2. `<html>` renders the matching class/style on the server.
3. A tiny pre-hydration script still exists as a resilience layer: it reads
   `document.cookie`, falls back to `matchMedia`, and corrects the DOM before
   visible content when the cookie is absent/stale.
4. The client provider receives `initialTheme`, updates the DOM after user
   changes, and writes the cookie back with `SameSite=Lax; Path=/; Max-Age=...`.
5. If migrating from the default strategy, the client may read the old
   `localStorage` value once and mirror it into the cookie.

Do not mix both strategies casually. If a product chooses the cookie-backed
variant, the cookie becomes canonical; `localStorage`, if kept at all, is only a
migration mirror. If a product keeps AMCore's default strategy, do not call
`cookies()` just for theme.

## Brand assets

- `apps/web/public/logo-dark.png` / `logo-light.png` — the AM monogram, one
  variant per theme. This is AMCore's own brand mark, kept deliberately (not
  a placeholder to be removed).
- `apps/web/public/icons/` — PWA manifest icons (`icon-192x192.png`,
  `icon-512x512.png`, `icon-512x512-maskable.png`), generated
  deterministically from the logo mark. `icon-512x512-maskable.png` keeps
  its content inside the safe zone so OS launchers can crop it to a
  circle/squircle without clipping — see `public/icons/README.md`.
- `apps/web/src/app/manifest.ts` — PWA name/description/colors.
  `background_color`/`theme_color` must be literal hex (the Web App
  Manifest spec is read before any CSS loads) — keep them in sync with
  `globals.css`'s light-mode `background`/`primary` by hand if that palette
  changes.

## Downstream rebrand checklist

A downstream product forks `apps/web` in place (per ADR-063's fork-in-place
model). `pnpm init:brand` (ADR-071) automates most of this — a repeatable,
non-destructive prompt/flag-driven script — leaving only what a script
cannot safely do for you:

1. **Logo** — supply your own light/dark PNGs; `init:brand` validates and
   copies them to `public/logo-dark.png` / `logo-light.png` for you (never
   generates them).
2. **PWA icons** — supply each size from `public/icons/README.md`;
   `init:brand` validates exact pixel dimensions and copies them into place.
   `manifest.ts`'s `background_color`/`theme_color` are **not** automated —
   update those by hand to match your new palette.
3. **Site metadata** — `init:brand` updates `manifest.ts`'s `name`/
   `short_name`/`description`, root `package.json`'s `name`/`description`,
   and `app/layout.tsx`'s actual metadata source
   (`messages/en.json`'s `meta.title`/`meta.description`; `ru.json`'s
   `meta.title` only — `meta.description` is never auto-translated, update
   it by hand).
4. **Theme tokens** — edit `globals.css`'s `:root`/`.dark` values by hand;
   not automated. Keep the `@theme inline` bridge and the token _names_
   stable if you can — other code depends on the names existing, not their
   values.
5. **Theme mode** — `init:brand` can set `DEFAULT_THEME_SETTING` in
   `theme.ts` for you (pass the mode, or answer the prompt) if your product
   forces `light`/`dark` only instead of `system` + a toggle; the resolution
   logic already supports a fixed setting with no further code changes.
   Not exposing a toggle in your UI stays a manual step.
6. **Theme persistence strategy** — `init:brand` records your choice
   (AMCore's default static-friendly `localStorage`, or the
   [cookie-backed SSR variant](#cookie-backed-ssr-theme-advanced-variant))
   in `PROJECT_CONTEXT.md`'s `theme_persistence` field. It does not generate
   the cookie-backed SSR variant's code — that stays the manual recipe
   linked above if you choose it.

It also records `PROJECT_CONTEXT.md`'s identity fields (`Mode`, `Product`,
`Purpose`, upstream-sync policy, workflow mode, `initialized_from_amcore_version`)
when you answer the corresponding prompts.

### Project scaffolding

`pnpm init:project` (ADR-071) is the separate, one-time, **destructive**
sibling command for structural choices `init:brand` deliberately never
touches — `init:project --mode=single --locale=<code>` removes locale
routing entirely (see
[i18n & errors § Downstream: running a single-locale app](./i18n-and-errors.md#downstream-running-a-single-locale-app))
and `init:project --storybook=disabled` removes the Storybook surface (see
[Storybook § Downstream: disabling Storybook](./storybook.md#downstream-disabling-storybook)).
Either flag works alone or both together in one invocation. See
`PROJECT_CONTEXT.md`'s "Frontend Starter Choices" section and ADR-071 for
the full contract and safety model (dry-run, typed confirmation, fail-closed
on drift).

## Inline style and contrast

- **Token-only styling, enforced.** Raw Tailwind color literals
  (`bg-[#8b5cf6]`), the default palette (`bg-red-500`, including behind
  variants) and the inline `style` prop all fail lint. Use the named utilities
  (`bg-card`, `text-foreground-muted`, ...); a CSS variable stays legal inside
  an arbitrary value, because a variable _is_ a token reference. CSS Modules
  are a supported surface under the same rule — colour comes from
  `var(--token)` — while `globals.css` is exempt, since it is where the tokens
  are declared. Full detail:
  [Boundaries & guardrails](./fsd-boundaries-and-guardrails.md#styling-the-palette-is-a-source-tokens-are-the-public-api).
- **Contrast.** <a id="contrast"></a>Every shipped token pair
  (`background`/`foreground`, `card`/`card-foreground`, `primary`/
  `primary-foreground`, the status `-soft`/solid pairs, etc.) must clear
  WCAG AA — 4.5:1 for normal text. This is enforced by a small,
  dependency-free test (`shared/lib/theme.test.ts`) that parses the actual
  `globals.css` values (not a hand-copied palette, which could silently
  drift) and checks them with the standard sRGB relative-luminance formula
  (`shared/lib/contrast.ts`). If you change a token's color, that test will
  tell you if you broke contrast.
- Status colors intentionally use a **darker shade than the "obvious" bright
  version** in light mode (e.g. `success` is a darker green, not the
  brightest one) specifically so the `-soft` pastel-background pairing
  passes AA — a bright/vivid shade reads fine as an icon color but commonly
  fails contrast as small text on its own pastel background.

## See also

- [Architecture & conventions](./architecture-and-conventions.md) — layers,
  routing, Server/Client Component defaults.
- `AGENTS.md` → Code conventions — the condensed cross-tool version of the
  token-only-styling rule.
- [Boundaries & guardrails](./fsd-boundaries-and-guardrails.md) — the lint and
  Stylelint rules that enforce the token-only rule above, what they
  deliberately do not cover, and how to add one.
