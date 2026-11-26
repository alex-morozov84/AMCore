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

| Group              | Tokens                                                                                            | Notes                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Core surfaces      | `background`, `foreground`, `card`, `popover`, `surface-elevated`, `surface-sunken`               | `surface-elevated` sits visually above `background` (e.g. a raised panel); `surface-sunken` recedes (e.g. a well/input background)       |
| Foreground steps   | `foreground-soft`, `foreground-muted`, `foreground-faint`                                         | Decreasing emphasis, for secondary/tertiary text                                                                                         |
| Borders            | `border`, `line-soft`, `line-strong`                                                              | `border` is the shadcn-standard name; `line-*` are AMCore's extension for finer control                                                  |
| shadcn components  | `primary`, `secondary`, `accent`, `muted`, `destructive`, `input`, `ring` (+ `-foreground` pairs) | `accent` is a **hover surface** (used by ghost/outline button variants), not the brand color — don't confuse it with `primary`           |
| Status             | `success`, `warning`, `info`, `danger` (+ `-soft` background pairs)                               | See [Contrast](#contrast) for why the shade differs from the "obvious" bright version                                                    |
| Charts / sidebar   | `chart-1`..`chart-5`, `sidebar-*`                                                                 | Distinguishable hues independent of `primary` — a chart shouldn't visually imply "this series is the brand"                              |
| Operations Console | `console-accent` / `console-accent-foreground`                                                    | Functional system-control-plane signal for active console navigation, live-status indication, and links; it is not a product brand token |

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

### A font scoped to one feature/layout

`--font-sans`/`--font-mono` in `@theme inline` cover the whole app. A feature
that needs its **own** font — the Operations Console does, loading IBM Plex
Sans/JetBrains Mono only inside
`apps/web/src/app/[locale]/<console alias>/layout.tsx` (`admin` unless you changed the alias in
`admin-console.json`) so a downstream fork that
disables the console never ships a dangling font import — still gets a real
Tailwind utility, not a repeated arbitrary-value class at every call site:

1. Load the font with `next/font/google` (or `next/font/local`) **inside the
   feature's own layout**, giving it a distinct `variable` name (e.g.
   `--console-font-mono`), and apply the returned `.variable` class names to
   that layout's wrapping element — this is the
   [documented Next.js Tailwind pattern](https://nextjs.org/docs/app/api-reference/components/font#tailwind-css),
   not a workaround.
2. Map that variable into a real utility in `globals.css`'s `@theme inline`
   block: `--font-console-mono: var(--console-font-mono);` generates
   `font-console-mono`, usable anywhere. This is a one-line, `var()`-only
   addition — the same "a variable is a token reference" exemption the
   arbitrary-value color rule already makes, and it belongs in the existing
   `console.tokens` seam so a downstream removal stays complete.
3. Never use `font-[family-name:var(--console-font-mono)]` at call sites —
   if you find yourself repeating an arbitrary-value class with the same
   `var(...)` more than once, step 2 is missing, not optional polish.

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

## No-flash: the pre-hydration script

The locale layout runs `getThemeInitScript()` as an inline script at the
start of the body. It applies the stored choice or the system preference
before the page content paints. Keep the script code-owned and pass the
request nonce. See [Browser security headers and CSP](./browser-security-and-csp.md).

Keep `suppressHydrationWarning` on the root HTML element. The script can
change its class before hydration. Components that render different text
or icons by theme start with the server-safe value and update after mount.
Verify initial paint and these controls separately in the running product.

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

1. `app/[locale]/layout.tsx` reads `cookies()` and derives `initialTheme`.
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

## Configure a new product

Run the wizard in a clean product checkout with the workspace dependencies installed. For a release-based product, first follow [source-tag setup](../operations/updating-a-fork.md#initialize-once-from-the-supported-source-tag).

1. Run `pnpm init:product` and choose English or Russian for the wizard.
2. Choose the languages the site serves. English and Russian ship with interface and email translations. One language gives pages bare paths such as `/login`. Two give pages language prefixes such as `/en/login` and `/ru/login`. [Add another language](i18n-and-errors.md#recipe-add-a-third-locale) before enabling it. Once you add another catalogue, manage product settings manually. The wizard supports English and Russian catalogues and exits before writing in a checkout with additional catalogues.
3. Choose whether to enter the name and description once for both languages or separately for each language. The names appear in browser tabs (`<title>`). Enter optional descriptions for the HTML description metadata. On first setup, a skipped starter description becomes the product name. The default site's name and description supply install metadata.
4. Choose available themes and, when both are available, the first-visit setting. A fixed theme applies before the first page paint, including when browser storage is unavailable. Storybook keeps both themes. Choose whether to show the top navigation progress bar. [Theme and navigation details](route-progress.md).
5. Enable or disable the path-based Operations Console. Existing aliases and host placements are retained. To change them later, follow the [Console guide](../operations-console/configuration.md#topology) or [product administration guide](../product-admin/placement-and-sessions.md#configure-or-move-the-administration-area).
6. Keep or replace the three install icons. Supply ready PNG files in the sizes listed in [the icon guide](../../apps/web/public/icons/README.md). Logo assets and color tokens are separate customizations.
7. Choose the team's Git workflow and [automatic checks](../operations/ci-security.md#choose-automatic-checks-for-a-product). Configure GitHub branch protection separately. Review the settings summary and confirm. Choose **Show file changes** to inspect the full plan before deciding. The wizard records the starting Git version when first establishing product identity.
8. Start Docker and run `pnpm local` from the project root. Open the URL it prints. See [the local development lifecycle](../operations/local-stands.md#develop-a-configured-product).

The wizard writes the files the application and CI read. It previews locale-dependent proxy output alongside source settings and writes the approved plan together. It runs type and lint checks after writing. Prepare the shared build and generated Prisma client as described in [product adoption](../product-admin/adoption.md#initialize-a-clean-product). Source changes require a new web build. Commit or stash local edits before applying another run. Rerun the wizard to edit settings.

### Scripted initialization

Use `--non-interactive` to suppress questions. Field flags answer individual questions. `--setup-language en|ru` chooses only the wizard language. Use `--dry-run` for a preview, or `--yes` to authorize a noninteractive write. On first setup, provide a name for the default site language, including for a preview. Omitted fields keep their current values unless first initialization requires starter metadata replacement.

| Setting                         | Flags                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Identity and purpose            | `--product-name`, `--name-en`, `--name-ru`, `--purpose`, `--package-name`                                                 |
| Site languages and descriptions | `--locales en,ru`, `--default-locale ru`, `--description-en`, `--description-ru`                                          |
| Appearance                      | `--theme-availability both\|light\|dark`, `--theme-mode system\|light\|dark`, `--route-progress on\|off`                  |
| Console                         | `--console-mode path\|disabled`                                                                                           |
| Install PNGs                    | `--icon-192`, `--icon-512`, `--icon-512-maskable`                                                                         |
| Git and CI                      | `--workflow-mode`, `--workflow-reference` for custom rules, `--ci-mode normal\|full\|heavy-off`, `--upstream-sync-policy` |

To replace the public logo assets, copy the appropriate PNG files into `apps/web/public` and wire them into the product interface. Follow the cookie-backed theme recipe separately if your product needs it. Edit the light and dark tokens and manifest colors together when rebranding.

### Recover from a failure

Read the last message of the command before you do anything else. Do not assume that an error
means nothing was written.

1. **"apply failed … rollback completed and the initial filesystem snapshot was restored".** The
   files are back as they were. Fix the cause and run the command again.
2. **"rollback failed", or a `.amcore-scaffold-transaction.json` file remains in the project root**
   (for example after the process was killed). Files may be partly changed. The journal blocks the
   next run on purpose. Keep the journal and the tree as they are. The message lists the recovery
   steps: restore the recorded states in reverse order, check the tree, and only then remove the
   journal. Never delete the journal only to get past the block. The tree was clean before the
   run and the command writes only the paths shown in the preview, so `git status` and
   `git diff` show exactly what changed; compare them with the recorded states in the journal
   before you restore anything. If the message does not list the steps, stop and ask the
   maintainers of your fork; do not guess.
3. **"filesystem committed but journal cleanup failed".** All files are already written; do not
   undo them. Check `git diff`. The journal is then only a leftover record: remove it after that
   check. The restore steps of item 2 do not apply.
4. **"Verification failed" after "Applied N change(s)".** The files are already written; `pnpm
typecheck` or `pnpm lint` found a problem and the command exits with code 1. Read the printed
   output and `git diff`. Fix the problem before you commit, or undo the changes with
   `git restore -- <path>` for each path that `git status` shows: the command only overwrites
   files that already exist in the starter and creates none.

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
- **Contrast.** <a id="contrast"></a>Normal text must meet WCAG AA's
  4.5:1 threshold. `shared/lib/theme.test.ts` checks the solid semantic token
  pairs listed in that test against the actual `globals.css` values using
  the sRGB relative-luminance formula (`shared/lib/contrast.ts`). This checks
  token pairs, not every component's rendered colors: opacity, translucent
  backgrounds, hover mixtures and pending states need browser proof.
  Token-only lint does not calculate contrast.
- The shared destructive Button uses opaque `bg-destructive` with
  `text-destructive-foreground`. Its hover fill mixes `var(--destructive)`
  with 10% of the ordinary `var(--foreground)` in OKLCH, without adding
  transparency. The browser [Storybook checks](./storybook.md#accessibility-gate-and-how-it-relates-to-the-testing-pyramid)
  cover normal/hover text on body, card and popover surfaces and the actual
  confirmation action in both themes. Preserve those checks when changing
  the variant; a passing solid-token check alone is insufficient.
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
