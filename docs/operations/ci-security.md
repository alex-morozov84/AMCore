# CI Security Automation

AMCore's GitHub-native CI security stack is intentionally lean: blocking gates
for new problems, report-only scans where review is enough, and a small amount
of workflow self-hardening to keep the example forkable.

## Current Gates

| Workflow                | Trigger                                 | Tooling                                                                                              | CI behavior                          |
| ----------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `codeql.yml`            | `push`, `pull_request`, weekly schedule | CodeQL (`javascript-typescript`, `build-mode: none`)                                                 | report-only, uploads SARIF           |
| `dependency-review.yml` | `pull_request`                          | GitHub Dependency Review                                                                             | blocking on `high+`                  |
| `security-scans.yml`    | `push`, `pull_request`, weekly schedule | gitleaks CLI, OSV-Scanner CLI                                                                        | gitleaks blocks; OSV is report-only  |
| `ci.yml`                | `push`, `pull_request`                  | Trivy CLI + boot-smoke                                                                               | Trivy report-only; boot-smoke blocks |
| `ci.yml`                | `push`, `pull_request`                  | Observability contract — static (`scripts/observability-contract/`, folded into the `promtool` job)  | blocking                             |
| `ci.yml`                | `push`, `pull_request`                  | Observability contract — live (real Prometheus/Alertmanager/Grafana boot)                            | blocking                             |
| `ci.yml`                | `push`, `pull_request`                  | Scaffolding contract — fast (`scripts/lib/*.test.mjs`, structural/fixture checks, no nested install) | blocking                             |
| `ci.yml`                | `push`, `pull_request`                  | Scaffolding contract — full (`pnpm test:scripts`, real install/typecheck/lint/build/test)            | blocking                             |
| `workflow-lint.yml`     | `push`, `pull_request`                  | actionlint, zizmor, action pin verifier                                                              | blocking                             |
| `pr-title.yml`          | `pull_request`                          | Conventional-Commits PR-title lint                                                                   | blocking (squash title = commit msg) |

## What Each Gate Proves

- **CodeQL** proves the repo is analyzed by GitHub's SAST pipeline and findings
  flow into the Security tab.
- **Dependency Review** blocks new high/critical dependency risk introduced by a
  PR diff. See [Handling Dependency Review exceptions](#handling-dependency-review-exceptions-allow-ghsas)
  for the narrow, documented `allow-ghsas` escape hatch.
- **gitleaks** blocks newly introduced secrets on `push`/`pull_request`; the
  weekly full-history scan is the backstop for historical drift.
- **OSV-Scanner** produces repository-level vulnerability SARIF on the weekly
  schedule without blocking routine development.
- **Trivy** scans the built production API image for `HIGH` / `CRITICAL`
  vulnerabilities and uploads SARIF.
- **boot-smoke** proves the exact production API image built in CI can:
  - pass the fast in-image checks;
  - run `prisma migrate deploy` successfully;
  - boot the API and serve `/api/v1/health/ready`;
  - let the Next.js web container return `/` `200`;
  - keep the worker healthy.
- **workflow-lint** checks workflow syntax and hardening rules, and verifies
  that every `uses:` pin matches the real tag commit (including annotated tags).
- **Observability contract (static)** — job id `promtool`, display name
  "Observability contract (static)" — cross-checks every alert/recording-rule
  and dashboard-panel PromQL expression, runbook links/anchors/panel
  citations, the Prometheus/Alertmanager image-pin consistency between
  `docker-compose.yml` and this workflow, and the public/private-boundary
  ratchet. No containers; pure static analysis of the repository. See
  `docs/operations/observability.md` → "Observability Contract Verification".
- **Observability contract (live)** — job id `observability-contract-live`,
  `needs: [promtool]` — boots the real `local-infra`/`monitoring` Compose
  profiles to prove the static layer's claims hold against a running stack:
  metric references and query evaluability against a live Prometheus, exact
  scrape-target/rule-group/Alertmanager-discovery state, Grafana's dashboard
  APIs against the committed dashboard JSON, a real Grafana→Prometheus query
  round trip, and a from-scratch Grafana old-volume migration smoke.
- **Scaffolding contract (fast)** — job id `scaffolding-contract` — every
  `pnpm init:brand`/`pnpm init:project` before/after fixture in `scripts/lib/`
  still matches the real file it targets, and the fixture-composition
  invariants (no two edit steps target the same file, every scaffold
  dimension composes safely with every other). Read-only against the real
  repo, no nested/disposable-copy install (the job's own top-level
  `pnpm install --frozen-lockfile` still runs), no Docker, ~6 seconds. Does
  **not** cover the
  public/private-path ratchet — that is the separate "Observability contract
  (static)" job above. No path filter: a change anywhere in the repo can
  drift a scaffolding fixture (this job exists because exactly that
  happened — `apps/web` and `docs/` changes drifted `scripts/lib/*.mjs`
  fixtures across several PRs with nothing in CI to catch it).
- **Scaffolding contract (full)** — job id `scaffolding-contract-full` —
  applies `pnpm init:brand`/`pnpm init:project` to disposable copies of the
  real repo and runs a real `pnpm install` plus typecheck/lint/build/test
  against the result, for both of `pnpm init:project`'s structural-choice
  scenarios. Genuinely slow (~9 minutes measured locally); `timeout-minutes:
20` gives it the same headroom as this pipeline's other real-install/build
  jobs. `needs: [lint, typecheck]` only, same as `test`/`web-e2e`, so it runs
  alongside them rather than queueing after `test`.

**The observability-contract and scaffolding-contract job contexts (four in
total: static/live, fast/full) are all listed in the tracked
`.github/rulesets/main.json`'s `required_status_checks`** — as with every
ruleset entry in this file, that is the _declared intent_ checked into
version control, not live GitHub state. Applying it (making the check
actually required to merge) is the separate owner action described in
[Strict security setup after forking](#strict-security-setup-after-forking)
below — required-check contexts only become selectable in that flow after
they have run at least once on the repository. A newly added job context
(such as the scaffolding-contract pair) needs that same one-time
re-application after its first real run on the repository, exactly like a
brand-new observability-contract job would.

## Handling CodeQL alerts (false positives)

CodeQL is report-only, but new alerts on a PR still need triage — **don't blanket-suppress**.

1. **Real issue → fix in code.** Many cookie/flag findings
   (`js/client-exposed-cookie`, `js/clear-text-cookie`) fire because the options are set
   via a getter/helper CodeQL can't resolve through — move them to an **inline literal at
   the `res.cookie()` call** so `httpOnly`/`secure` are statically visible.
2. **Vetted false positive → dismiss in the Security tab** (or via the REST API) with reason
   _false positive_ and a one-line justification. Example: `js/insufficient-password-hash`
   on a SHA-256 of a **high-entropy random token** is correct — slow KDFs only defend
   low-entropy _passwords_; a 256-bit random value has no brute-force surface.
3. **Always record the "why"** next to the code AND in the relevant feature doc, so
   the dismissal is reviewable and survives a re-scan.

Inline `// codeql[…]` / `// lgtm` comments are **not** honored by GitHub code scanning
([github/codeql#11427](https://github.com/github/codeql/issues/11427)) — they do not dismiss
alerts. Avoid a repo-wide `query-filters` exclusion for a local false positive: it disables
the query everywhere and hides real future findings.

## Handling Dependency Review exceptions (`allow-ghsas`)

Dependency Review blocks on `high+`, with no exceptions by default. An
`allow-ghsas` entry in `dependency-review.yml` is a **narrow, temporary,
documented exception**, not a way to silence the gate — use it only when all
of the following hold, and remove it the moment any one stops holding:

1. The flagged advisory genuinely has **no fixed version to upgrade to**
   (check `first_patched_version` via `gh api /advisories/<GHSA-id>` — don't
   assume from the dependency-review log alone).
2. The vulnerable package's actual reachability in **this repo's own usage**
   meaningfully lowers the risk (e.g. dev-only tooling that never reaches a
   production build artifact, or no untrusted-input path it would need to
   process).
3. The exception is recorded in **two places**: an inline comment on the
   `allow-ghsas` line in the workflow file (the advisory IDs, why they're
   allowed, and the removal condition — including the exact command to
   re-check), and a tracked backlog/issue entry with a trigger to re-check on
   the next relevant dependency bump. AMCore's own maintainer backlog is
   private and absent from public forks — a fork following this policy
   should use whatever public
   issue tracker or `docs/` note it already uses for this kind of follow-up;
   the inline workflow comment alone should always be self-sufficient to
   understand and re-verify the exception, since that's the part every fork
   actually gets.

Current example: `image-size@2.0.2` (transitive via
`@storybook/nextjs-vite`, Track 8) — see the comment above `allow-ghsas` in
`.github/workflows/dependency-review.yml`.

## What a fork inherits (and what it doesn't)

A clone or fork receives the repository **files** that _declare_ the intended policy — but
GitHub-hosted **enforcement is external repository state** that does not travel with git.
Three categories:

1. **Inherited files** — workflows, `.github/rulesets/*.json`, `scripts/setup-repo-security.sh`,
   `commitlint.config.js`, `.husky/*`, docs. Present in any clone/fork.
2. **External GitHub state** — applied rulesets / branch protection, merge methods, secret
   scanning, required checks, environments, secrets. **Not** inherited; it lives on github.com.
3. **Activation** — running `setup-repo-security.sh` reconciles AMCore's supported
   `strict` settings from the JSON; environments / secrets / deploy credentials
   are configured separately.

| Capability                                                  | Fork receives        | Active / enforced automatically                                                        |
| ----------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------- |
| Workflows, ruleset JSON, setup script, commitlint config    | Files                | No guarantee                                                                           |
| GitHub Actions checks                                       | Workflow definitions | Only when Actions / workflow runs are enabled (scheduled runs off by default on forks) |
| Required checks, squash-only, protected `main` / `v*` tags  | Declarative JSON     | No — apply the setup script                                                            |
| Secret scanning, push protection, Dependabot alerts/updates | No                   | Apply the setup script; availability depends on GitHub plan / visibility               |
| Husky commit hooks                                          | Hook files           | After `pnpm install`; local and bypassable                                             |
| Environments, secrets, variables, deployment credentials    | No                   | Configure separately; the setup script does not create them                            |

> Repository files **declare** the intended policy. GitHub-hosted enforcement is **external
> repository state**. For `strict` mode, run `setup-repo-security.sh` to reconcile
> the supported settings; configure deployment environments and secrets separately.
> **Do not infer live enforcement from tracked files** — verify the actual state
> via the GitHub UI / API.

A plain `git clone` of _this_ repo works against the same remote's settings; a **fork** (or a new
repository) has its **own** external state, which is independently configured and is not
guaranteed to match upstream (platform/org defaults and fork-network rules may differ).

## Workflow modes for forks

Downstream products should declare one workflow mode in `PROJECT_CONTEXT.md`:

- `strict` — mirrors AMCore upstream: protected `main`, PR-only changes,
  squash-only merges, required status checks, immutable release tags, secret
  scanning, push protection, Dependabot alerts, and Dependabot security updates. Use
  `scripts/setup-repo-security.sh` to apply the supported GitHub repository
  settings.
- `flexible` — keeps the same CI/security files but lets the product relax
  branch protection, merge method, or review rules. Document the chosen rules
  and understand that GitHub will not enforce guarantees you did not enable.
- `custom` — the product owns a different workflow. Link the authoritative
  workflow and repository-protection documentation from `PROJECT_CONTEXT.md`.

AMCore upstream uses `strict`. Agents and contributors must follow the mode
declared by the checkout instead of assuming every fork uses protected `main`.

## Strict security setup after forking

Some protections — branch rulesets, secret scanning, push protection — are
**repository settings** and do NOT travel with a clone/fork. For a fork that chose
`strict`, enable them with one command:

1. Install the GitHub CLI — `brew install gh` (or see https://cli.github.com).
2. Sign in with repository **admin** access — `gh auth login`
   (no manual token needed; the CLI handles it).
3. Apply the settings — `bash ./scripts/setup-repo-security.sh` (also needs `jq`).

This enables native **secret scanning** + **push protection**, the **dependency
graph** + Dependabot alerts + **Dependabot security updates** (auto-PRs that fix
vulnerable dependencies — the only channel that patches a vuln whose fix is a
semver-major, since `dependabot.yml` ignores majors), and imports the **rulesets**
for `main` (PR-only,
**Squash-only** merges, required status checks, block force-push, restrict
deletions) and for **release tags** (`refs/tags/v*` — block tag update and
deletion, so published versions are immutable). It is the supported `strict`
setup. It is **idempotent** — safe to re-run (it also removes the retired
`Protect develop` ruleset if present).

Notes:

- `setup-repo-security.sh`, `verify-action-pins.sh`, and the `.husky/pre-push`
  hook (see [Local Pre-Push Checks](#local-pre-push-checks) — only its
  workflow-lint layer is optional/graceful-if-absent, not the whole hook)
  require a Unix-like shell (`bash`/`sh`) on macOS, Linux, or WSL rather than
  native Windows PowerShell.
- Install `gh` and `jq` via your OS package manager or from their upstream
  releases, then ensure they are on your `PATH`.
- Required status-check contexts only become selectable after those checks have
  run at least once on the repository, so run the script after CI has run on a
  push/PR.
- The rulesets use `required_approving_review_count: 0` for a solo-maintainer flow
  (PR-only merges enforced, self-merge allowed). Raise it to `1+` in
  `.github/rulesets/*.json` when the repository gains a second maintainer.

## Maintenance Notes

### Action Pins

All `uses:` references are pinned to full commit SHAs, including GitHub-owned
actions. The trailing `# <version>` comment is required and is checked by
`scripts/verify-action-pins.sh`.

Before reviewing a new or changed action pin locally, run:

```bash
bash ./scripts/verify-action-pins.sh
```

This catches the annotated-tag trap (`refs/tags/vX` object vs
`refs/tags/vX^{}` commit) that ordinary SHA-format checks do not.

### Docker Base Image Pins

Both `apps/api/Dockerfile` (`node:24-slim`) and `apps/web/Dockerfile`
(`node:24-alpine`) pin their `FROM` lines to a full digest
(`node:24-slim@sha256:...` / `node:24-alpine@sha256:...`), the same principle
as Action Pins above applied to container images: a mutable tag can change
under you without review. Re-resolve the digest before bumping it:

```bash
docker buildx imagetools inspect node:24-slim    # or node:24-alpine for apps/web
```

and update both `FROM` lines in that Dockerfile together (`base` and `runner`
stages share one digest per image). The `docker-image-smoke` CI job scans the
built API image with Trivy, which flags known vulnerabilities in the currently
pinned image — it does **not** detect that the base image has moved to a newer
digest upstream. Re-resolving the digest is a manual maintainer step (or wire
up separate Docker base-image update automation, e.g. Dependabot's `docker`
ecosystem or Renovate). The weekly **Dependency freshness** workflow (see
below) tracks both Dockerfiles and raises a _signal_ when either pinned digest
has drifted from upstream — the bump itself stays manual.

### Local Commit Hooks: Scope and Limits

Two Husky hooks run on every local commit, and both are convenience layers —
CI is the actual gate, not either hook:

- **`.husky/commit-msg`** runs `commitlint` against the commit message. This
  covers the whole repository; there's nothing workspace-scoped about a
  commit message.
- **`.husky/pre-commit`** runs `lint-staged` against staged files. Its
  `prettier --write` step formats every matched file repo-wide, including
  inside `apps/*` and `packages/*`. Its ESLint step is workspace-aware by
  design: `apps/api/**`, `apps/web/**`, and `packages/shared/**` each get
  linted via `pnpm --filter <workspace> exec eslint`, which runs with that
  workspace's directory as cwd — the same mechanism `pnpm lint` (via Turbo)
  uses for that workspace in CI, so it resolves the same nested
  `eslint.config.mjs` and behaves identically (an explicit `eslint -c
<path>` from the repo root also works, but leaves cwd at the repo root,
  which confuses cwd-relative plugin checks like Next.js's pages-directory
  detection into printing a spurious warning). A catch-all
  `*.{ts,tsx,js,jsx}` pattern still exists in `lint-staged` for genuinely
  root-level files (currently only `eslint.config.js` and
  `commitlint.config.js`) — it does nothing for files already covered by a
  workspace-specific pattern above, since the root `eslint.config.js`
  deliberately ignores `apps/**`/`packages/**` (that root config is for the
  two root-level files only, not a fallback for the workspaces).

**Do not add a new lintable workspace under `apps/*` or `packages/*` without
also adding a matching `lint-staged` pattern** in the root `package.json`
using `pnpm --filter <workspace> exec eslint`, or its staged files
will silently skip ESLint locally (formatting still runs) while still being
correctly caught by CI's `pnpm lint`. This is exactly the gap found and fixed
2026-07-18: `packages/shared` had no `eslint.config.mjs`/`lint` script at all
(never linted anywhere, not even in CI) until that gap surfaced 19 real,
long-accumulated lint violations on first run, and the pre-commit hook's
`*.{ts,tsx,js,jsx}` pattern ran ESLint from the repo root — which silently
skipped every file under `apps/**`/`packages/**` because the root config
ignores those paths, and `--no-warn-ignored` suppressed even the "file was
ignored" notice. `pnpm lint`/`pnpm --filter <workspace> lint` was and remains
the authoritative local check; run it before relying on a clean commit if
you're touching a workspace's ESLint config or adding a new lintable
workspace.

### Local Pre-Push Checks

`.husky/pre-push` runs two kinds of check, in this order:

1. **Mandatory, not graceful-if-absent** — `pnpm test:observability-contract`
   (the static half only, not `:live`): ~0.5s, no Docker, no external binary.
   `pnpm` is a hard requirement for this repo (husky itself only runs via a
   pnpm-managed install), so unlike the tools below there is no "not
   installed locally" case to tolerate. This is what catches a leaked private
   `ai/<name>.md`-shaped path citation (AGENTS.md → "Never cite a private
   `ai/<name>.md`-shaped path from public code or docs") before it can reach
   a PR, not only when CI runs or someone remembers to check by hand.
2. **Optional, graceful-if-absent workflow-lint convenience layer**:
   - `bash ./scripts/verify-action-pins.sh`
   - `actionlint`
   - `zizmor --offline .github/workflows/*.yml`

   If `actionlint` or `zizmor` is not installed locally, the hook prints a
   warning and skips that check; CI remains the hard gate via
   `workflow-lint.yml`. To opt into the full local loop, install `actionlint`
   and `zizmor` from their upstream GitHub releases and place the binaries on
   your `PATH`. Match the versions pinned in
   `.github/workflows/workflow-lint.yml` — that workflow is the source of
   truth, so no version is duplicated here.

### CLI Tool Versions

Dependabot updates:

- `npm` dependencies;
- `uses:` action pins in the `github-actions` ecosystem.

Dependabot does **not** update versions for binaries downloaded via `curl`, so
these require manual bumps:

- `gitleaks`
- `osv-scanner`
- `trivy`
- `zizmor`
- `actionlint`

When bumping one of these tools:

1. update the version and SHA-256 together;
2. verify the checksum against the upstream release asset;
3. re-run the relevant local validation before review.

### Dependency freshness report

Dependabot handles patch/minor npm + action bumps and (per repo, see
[_Strict security setup_](#strict-security-setup-after-forking)) opens security
PRs — but it does not surface **semver-major** npm updates (ignored in
`dependabot.yml`), Docker base-image **digest drift**, or newer **curl-pinned CLI
tool** releases. The `dependency-freshness.yml` workflow closes that visibility
gap: on a weekly schedule (and on-demand via `workflow_dispatch`) it runs
`scripts/dependency-freshness.mjs` and **upserts a single tracking issue** (label
`dependency-freshness`, edited in place) listing all three. It opens no PRs and is
a report only — triage each item and bump deliberately. For semver-major updates,
use a separate PR, read the upstream migration notes/changelog, record any
intentional deferral in the product's own backlog or issue tracker, and run the
full relevant CI before merging.

Forkers can keep this stack lean:

- keep GitHub-native features first;
- prefer report-only scans where blocking does not buy meaningful signal;
- block only on checks that protect the current change set or workflow integrity;
- re-use the production image for image scanning and boot-smoke rather than
  rebuilding separate artifacts.
