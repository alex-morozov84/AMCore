# Project Context

This tracked file identifies the intent of this checkout. Agents and contributors
must read it before deciding whether they are changing AMCore itself or building a
separate product from the starter.

## Identity

- **Mode:** `upstream-starter`
- **Product:** AMCore
- **Purpose:** Continue development of AMCore and its reusable, production-oriented
  NestJS API starter.
- **Canonical upstream:** https://github.com/alex-morozov84/AMCore
- **Upstream sync policy:** N/A — this checkout is the canonical upstream.
- **Workflow mode:** `strict` (protected `main`, PR-only, squash-only, required CI).
- **Public workflow:** See `AGENTS.md` and `CONTRIBUTING.md`.
- **Current maintainer status:** If `ai/` exists, read `ai/STATUS.md`.
- **i18n_mode:** multi
- **base_locale:** en
- **supported_locales:** [en, ru]
- **frontend_storybook:** enabled
- **theme_persistence:** local-storage
- **initialized_from_amcore_version:** N/A — this checkout is AMCore itself.

One field per line, machine-editable by the fork initialization tooling (see
"Frontend Starter Choices" below) — do not fold multiple fields back into a
single prose bullet.

## Mode Contract

`upstream-starter` means this checkout identifies itself as AMCore:

- contribute reusable starter improvements and AMCore product features;
- preserve AMCore's public contracts, documentation, and release history;
- follow the `strict` workflow mode described in `AGENTS.md` and `CONTRIBUTING.md`.

A product fork is not fully initialized while this file still says
`upstream-starter`. Before product-specific work, change the mode to
`downstream-product` and replace the identity fields with the fork's real context.

For `downstream-product`, record at minimum:

- product name and purpose;
- original AMCore upstream URL;
- whether and how upstream changes will be synchronized;
- workflow mode: `strict`, `flexible`, or `custom`;
- where the product roadmap, current status, and product-specific decisions live;
- the frontend starter choices below (`i18n_mode`, `frontend_storybook`,
  `theme_persistence`, `initialized_from_amcore_version`).

Do not infer mode from directory names, package names, git remotes, or the presence
of GitHub settings. The owner of a downstream product must declare the mode here.

## Frontend Starter Choices

`apps/web` ships a fork-in-place default (multi-locale, Storybook on,
`localStorage` theme persistence). A downstream product records the choices it
actually made instead of leaving them implicit in deleted/kept files:

- **`i18n_mode`:** `multi` or `single`. AMCore upstream ships `multi`. A
  single-locale downstream product removes locale routing entirely rather
  than configuring it away — see
  `docs/frontend/i18n-and-errors.md` → _Downstream: running a single-locale
  app_.
- **`base_locale` / `supported_locales`:** the locale(s) the product actually
  ships. For `i18n_mode: single`, `supported_locales` has exactly one entry
  equal to `base_locale`.
- **`frontend_storybook`:** `enabled` or `disabled`. AMCore upstream keeps
  Storybook mandatory (CI `storybook` job, `build-storybook` +
  `test:storybook`) as the default — see `docs/frontend/storybook.md`. A
  `disabled` choice is a one-time removal of `.storybook/`, co-located
  stories, Storybook scripts/dependencies, the CI job, and Storybook-specific
  public docs, not a `SKIP_STORYBOOK` bypass that leaves the surface present
  but unused.
- **`theme_persistence`:** `local-storage` (AMCore's default) or
  `cookie-ssr` (an advanced, opt-in downstream variant — see
  `docs/frontend/brand-theme-and-tokens.md` → _Cookie-backed SSR theme
  (advanced variant)_). This field records the product's choice; it does not
  imply a second live theme implementation ships in the starter itself.
- **`initialized_from_amcore_version`:** the AMCore tag or commit the fork
  was initialized from, e.g. `v0.4.0`. Lets later tooling and upstream-sync
  decisions know the fork's starting baseline.

These fields are maintained by the fork initialization tooling
(`pnpm init:brand` / `pnpm init:project`) once it exists, or by hand in a
downstream fork until then. Their absence means "AMCore's shipped defaults
apply," not "undecided."

## Workflow Modes

- `strict` — protected `main`, PR-only changes, squash-only merges, required CI,
  and immutable release tags. This is AMCore upstream's mode and is supported by
  `scripts/setup-repo-security.sh`.
- `flexible` — a downstream product may relax branch protection, merge method, or
  local delivery rules while the team is moving quickly. Document the chosen
  rules in this file or the product's contributor guide.
- `custom` — a downstream product owns a different workflow. Link the product's
  authoritative workflow documentation from this file.
