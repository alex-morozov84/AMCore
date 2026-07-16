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
- **Workflow mode:** `strict` (protected `main`, PR-only, squash-only, required CI).
- **Public workflow:** See `AGENTS.md` and `CONTRIBUTING.md`.
- **Current maintainer status:** If `ai/` exists, read `ai/STATUS.md`.

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
- where the product roadmap, current status, and product-specific decisions live.

Do not infer mode from directory names, package names, git remotes, or the presence
of GitHub settings. The owner of a downstream product must declare the mode here.

## Workflow Modes

- `strict` — protected `main`, PR-only changes, squash-only merges, required CI,
  and immutable release tags. This is AMCore upstream's mode and is supported by
  `scripts/setup-repo-security.sh`.
- `flexible` — a downstream product may relax branch protection, merge method, or
  local delivery rules while the team is moving quickly. Document the chosen
  rules in this file or the product's contributor guide.
- `custom` — a downstream product owns a different workflow. Link the product's
  authoritative workflow documentation from this file.
