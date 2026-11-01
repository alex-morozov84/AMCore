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
- **theme_persistence:** local-storage
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
- the build fields below (`theme_persistence`, `initialized_from_amcore_version`).
  `theme_persistence` describes the build you ship; keep it true to it.

Do not infer mode from directory names, package names, git remotes, or the presence
of GitHub settings. The owner of a downstream product must declare the mode here.

## Build Settings

Which locales the build serves and how the Operations Console is served are **settings
files**, not fields here. They are read by the code, so editing them changes the build
after a rebuild:

| Setting                                                                  | File                                            | Guide                                          |
| ------------------------------------------------------------------------ | ----------------------------------------------- | ---------------------------------------------- |
| Served locales and the default locale                                    | `packages/shared/src/config/locales.json`       | `docs/frontend/i18n-and-errors.md`             |
| Operations Console mode (`disabled`, `path`, `host`) and its URL segment | `packages/shared/src/config/admin-console.json` | `docs/operations-console/configuration.md`     |
| Product administration placement                                         | `packages/shared/src/config/product-admin.json` | `docs/product-admin/placement-and-sessions.md` |

Storybook is part of every project, and the route-progress bar follows the
`ROUTE_PROGRESS_ENABLED` source flag in
`apps/web/src/shared/lib/route-progress/route-progress-flag.ts` (see
`docs/frontend/route-progress.md`).

Two fields in this file describe the product's choices:

- **`theme_persistence`:** `local-storage` (AMCore's default) or `cookie-ssr` (an
  advanced, opt-in downstream variant — see `docs/frontend/brand-theme-and-tokens.md`
  → _Cookie-backed SSR theme (advanced variant)_). This field records the product's
  choice; it does not imply a second live theme implementation ships in the starter.
- **`initialized_from_amcore_version`:** the AMCore tag or commit the fork was
  initialized from, e.g. `v0.4.0`. It gives later work and upstream-sync decisions the
  fork's starting baseline.

`pnpm init:brand` writes the identity, workflow, theme and
`initialized_from_amcore_version` fields. No command edits the settings files.

## Workflow Modes

- `strict` — protected `main`, PR-only changes, squash-only merges, required CI,
  and immutable release tags. This is AMCore upstream's mode and is supported by
  `scripts/setup-repo-security.sh`.
- `flexible` — a downstream product may relax branch protection, merge method, or
  local delivery rules while the team is moving quickly. Document the chosen
  rules in this file or the product's contributor guide.
- `custom` — a downstream product owns a different workflow. Link the product's
  authoritative workflow documentation from this file.
