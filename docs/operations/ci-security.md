# CI Security Automation

AMCore's GitHub-native CI security stack is intentionally lean: blocking gates
for new problems, report-only scans where review is enough, and a small amount
of workflow self-hardening to keep the example forkable.

## Current Gates

| Workflow                | Trigger                                 | Tooling                                              | CI behavior                          |
| ----------------------- | --------------------------------------- | ---------------------------------------------------- | ------------------------------------ |
| `codeql.yml`            | `push`, `pull_request`, weekly schedule | CodeQL (`javascript-typescript`, `build-mode: none`) | report-only, uploads SARIF           |
| `dependency-review.yml` | `pull_request`                          | GitHub Dependency Review                             | blocking on `high+`                  |
| `security-scans.yml`    | `push`, `pull_request`, weekly schedule | gitleaks CLI, OSV-Scanner CLI                        | gitleaks blocks; OSV is report-only  |
| `ci.yml`                | `push`, `pull_request`                  | Trivy CLI + boot-smoke                               | Trivy report-only; boot-smoke blocks |
| `workflow-lint.yml`     | `push`, `pull_request`                  | actionlint, zizmor, action pin verifier              | blocking                             |
| `pr-title.yml`          | `pull_request`                          | Conventional-Commits PR-title lint                   | blocking (squash title = commit msg) |

## What Each Gate Proves

- **CodeQL** proves the repo is analyzed by GitHub's SAST pipeline and findings
  flow into the Security tab.
- **Dependency Review** blocks new high/critical dependency risk introduced by a
  PR diff.
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

| Capability                                                 | Fork receives        | Active / enforced automatically                                                        |
| ---------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------- |
| Workflows, ruleset JSON, setup script, commitlint config   | Files                | No guarantee                                                                           |
| GitHub Actions checks                                      | Workflow definitions | Only when Actions / workflow runs are enabled (scheduled runs off by default on forks) |
| Required checks, squash-only, protected `main` / `v*` tags | Declarative JSON     | No — apply the setup script                                                            |
| Secret scanning, push protection, dependency alerts        | No                   | Apply the setup script; availability depends on GitHub plan / visibility               |
| Husky commit hooks                                         | Hook files           | After `pnpm install`; local and bypassable                                             |
| Environments, secrets, variables, deployment credentials   | No                   | Configure separately; the setup script does not create them                            |

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
  scanning, push protection, and Dependabot alerts. Use
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
graph** + Dependabot alerts, and imports the **rulesets** for `main` (PR-only,
**Squash-only** merges, required status checks, block force-push, restrict
deletions) and for **release tags** (`refs/tags/v*` — block tag update and
deletion, so published versions are immutable). It is the supported `strict`
setup. It is **idempotent** — safe to re-run (it also removes the retired
`Protect develop` ruleset if present).

Notes:

- `setup-repo-security.sh`, `verify-action-pins.sh`, and the optional
  `.husky/pre-push` hook require a Unix-like shell (`bash`/`sh`) on macOS,
  Linux, or WSL rather than native Windows PowerShell.
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

`apps/api/Dockerfile` pins its `node:24-slim` `FROM` lines to a full digest
(`node:24-slim@sha256:...`), the same principle as Action Pins above applied to
container images: a mutable tag can change under you without review. Re-resolve
the digest before bumping it:

```bash
docker buildx imagetools inspect node:24-slim
```

and update both `FROM` lines together (`base` and `runner` stages currently
share one digest). The `docker-image-smoke` CI job scans the built image with
Trivy, which flags known vulnerabilities in the currently pinned image — it
does **not** detect that `node:24-slim` has moved to a newer digest upstream.
Re-resolving the digest is a manual maintainer step (or wire up separate Docker
base-image update automation, e.g. Dependabot's `docker` ecosystem or Renovate).

### Optional Local Workflow-Lint Tooling

The repository also ships a convenience `.husky/pre-push` hook that runs:

- `bash ./scripts/verify-action-pins.sh`
- `actionlint`
- `zizmor --offline .github/workflows/*.yml`

The hook is **graceful-if-absent**:

- if `actionlint` or `zizmor` is not installed locally, the hook prints a
  warning and skips that check;
- CI remains the hard gate via `workflow-lint.yml`.

To opt into the full local loop, install `actionlint` and `zizmor` from their
upstream GitHub releases and place the binaries on your `PATH`. Match the versions
pinned in `.github/workflows/workflow-lint.yml` — that workflow is the source of
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

## Forker Expectations

Forkers can keep this stack lean:

- keep GitHub-native features first;
- prefer report-only scans where blocking does not buy meaningful signal;
- block only on checks that protect the current change set or workflow integrity;
- re-use the production image for image scanning and boot-smoke rather than
  rebuilding separate artifacts.
