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

## Security setup after forking

Some protections — branch rulesets, secret scanning, push protection — are
**repository settings** and do NOT travel with a clone/fork. Enable them with one
command:

1. Install the GitHub CLI — `brew install gh` (or see https://cli.github.com).
2. Sign in with repository **admin** access — `gh auth login`
   (no manual token needed; the CLI handles it).
3. Apply the settings — `bash ./scripts/setup-repo-security.sh` (also needs `jq`).

This enables native **secret scanning** + **push protection**, the **dependency
graph** + Dependabot alerts, and imports the branch **rulesets** for `main` and
`develop` (PR-only merges, required status checks, block force-push, restrict
deletions). It is **idempotent** — safe to re-run.

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

### Optional Local Workflow-Lint Tooling

The repository also ships a convenience `.husky/pre-push` hook that runs:

- `bash ./scripts/verify-action-pins.sh`
- `actionlint`
- `zizmor --offline .github/workflows/*.yml`

The hook is **graceful-if-absent**:

- if `actionlint` or `zizmor` is not installed locally, the hook prints a
  warning and skips that check;
- CI remains the hard gate via `workflow-lint.yml`.

To opt into the full local loop, install the same tools used in CI:

- `actionlint` `v1.7.12`
- `zizmor` `v1.25.2`

Install them from their upstream GitHub releases and place the binaries on your
`PATH`.

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
