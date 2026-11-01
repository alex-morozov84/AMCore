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
- **frontend_route_progress:** enabled
- **theme_persistence:** local-storage
- **admin_console:** enabled
- **admin_console_mode:** path
- **admin_console_slug:** admin
- **initialized_from_amcore_version:** N/A — this checkout is AMCore itself.

One field per line, machine-editable by `pnpm init:brand` — do not fold multiple
fields back into a single prose bullet.

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
- the frontend starter choice fields below (`i18n_mode`, `frontend_storybook`,
  `frontend_route_progress`, `theme_persistence`, `admin_console`,
  `admin_console_mode`, `admin_console_slug`, `initialized_from_amcore_version`).
  They describe the build you ship; keep them true to it.

Do not infer mode from directory names, package names, git remotes, or the presence
of GitHub settings. The owner of a downstream product must declare the mode here.

## Frontend Starter Choices

`apps/web` ships one configuration: two locales (`en`, `ru`), Storybook, the top
route-progress bar, `localStorage` theme persistence and the Operations Console in
path mode at `/admin`. The fields above record that configuration so a person or an
agent can read it without inspecting the code. They are documentation, never runtime
configuration: editing a value here does not change the build. If you change the build
yourself, update the matching field so the record stays true; this release provides no
command for such changes.

- **`i18n_mode`, `base_locale`, `supported_locales`:** the routing mode and the
  locales the build serves. See `docs/frontend/i18n-and-errors.md`.
- **`frontend_storybook`:** `enabled`. Storybook is part of every project (CI
  `storybook` job, `build-storybook`, `test:storybook`); see
  `docs/frontend/storybook.md`.
- **`frontend_route_progress`:** `enabled`. The bar follows the
  `ROUTE_PROGRESS_ENABLED` source flag in
  `shared/lib/route-progress/route-progress-flag.ts`; a developer can flip the flag by
  hand. See `docs/frontend/route-progress.md`.
- **`theme_persistence`:** `local-storage` (AMCore's default) or `cookie-ssr` (an
  advanced, opt-in downstream variant — see `docs/frontend/brand-theme-and-tokens.md`
  → _Cookie-backed SSR theme (advanced variant)_). This field records the product's
  choice; it does not imply a second live theme implementation ships in the starter.
- **`admin_console`:** `enabled`. The Operations Console is the
  `SystemRole.SUPER_ADMIN`-only system control plane, not a generic product
  backoffice; see `docs/operations-console/README.md`.
- **`admin_console_mode`:** `path` or `host`. `path` serves Console pages on the
  product host; `host` serves them on a separate host. The mode is a deployment and
  routing choice, not an authorization role.
- **`admin_console_slug`:** the literal URL path segment for Console pages (`admin`).
  It is not a hostname or subdomain label, including in `host` mode.
- **`initialized_from_amcore_version`:** the AMCore tag or commit the fork was
  initialized from, e.g. `v0.4.0`. It gives later work and upstream-sync decisions the
  fork's starting baseline.

`pnpm init:brand` writes the identity, workflow, theme and
`initialized_from_amcore_version` fields. No command writes the other fields in this
section.

## Workflow Modes

- `strict` — protected `main`, PR-only changes, squash-only merges, required CI,
  and immutable release tags. This is AMCore upstream's mode and is supported by
  `scripts/setup-repo-security.sh`.
- `flexible` — a downstream product may relax branch protection, merge method, or
  local delivery rules while the team is moving quickly. Document the chosen
  rules in this file or the product's contributor guide.
- `custom` — a downstream product owns a different workflow. Link the product's
  authoritative workflow documentation from this file.
