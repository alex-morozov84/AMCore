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
- **Public workflow:** See `AGENTS.md` and `CONTRIBUTING.md`.
- **Current maintainer status:** If `ai/` exists, read `ai/STATUS.md`.

## Mode Contract

`upstream-starter` means this checkout identifies itself as AMCore:

- contribute reusable starter improvements and AMCore product features;
- preserve AMCore's public contracts, documentation, and release history;
- send changes through the protected `main` workflow described in `AGENTS.md`.

A product fork is not fully initialized while this file still says
`upstream-starter`. Before product-specific work, change the mode to
`downstream-product` and replace the identity fields with the fork's real context.

For `downstream-product`, record at minimum:

- product name and purpose;
- original AMCore upstream URL;
- whether and how upstream changes will be synchronized;
- where the product roadmap, current status, and product-specific decisions live.

Do not infer mode from directory names, package names, git remotes, or the presence
of GitHub settings. The owner of a downstream product must declare the mode here.
