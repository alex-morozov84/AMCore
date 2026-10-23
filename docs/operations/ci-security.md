# CI Security Automation

AMCore's GitHub-native CI security stack is intentionally lean: blocking gates
for new problems, report-only scans where review is enough, and a small amount
of workflow self-hardening to keep the example forkable.

## Current Gates

| Workflow                     | Trigger                                 | Tooling                                                                                              | CI behavior                          |
| ---------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `codeql.yml`                 | `push`, `pull_request`, weekly schedule | CodeQL (`javascript-typescript`, `build-mode: none`)                                                 | report-only, uploads SARIF           |
| `dependency-review.yml`      | `pull_request`                          | GitHub Dependency Review                                                                             | blocking on `high+`                  |
| `security-scans.yml`         | `push`, `pull_request`, weekly schedule | gitleaks CLI, OSV-Scanner CLI                                                                        | gitleaks blocks; OSV is report-only  |
| `ci.yml`                     | `push`, `pull_request`                  | Route bundle budgets after the web build (`pnpm check:route-budgets`, Build job)                     | blocking                             |
| `ci.yml`                     | `push`, `pull_request`                  | Trivy CLI + boot-smoke                                                                               | Trivy report-only; boot-smoke blocks |
| `ci.yml`                     | `push`, `pull_request`                  | Observability contract — static (`scripts/observability-contract/`, folded into the `promtool` job)  | blocking                             |
| `ci.yml`                     | `push`, `pull_request`                  | Observability contract — live (real Prometheus/Alertmanager/Grafana boot)                            | blocking                             |
| `ci.yml`                     | `push`, `pull_request`                  | Scaffolding contract — fast (`scripts/lib/*.test.mjs`, structural/fixture checks, no nested install) | blocking                             |
| `ci.yml`                     | `push`, `pull_request`                  | Scaffolding contract — six-row covering array in two parallel shards plus shadow selector telemetry  | blocking; full lane always runs      |
| `scaffolding-exhaustive.yml` | weekly schedule, manual                 | Original eight real-install scaffolding recipes (`pnpm test:scripts:exhaustive`)                     | backstop, not required               |
| `workflow-lint.yml`          | `push`, `pull_request`                  | actionlint, zizmor, action pin verifier                                                              | blocking                             |
| `pr-title.yml`               | `pull_request`                          | Conventional-Commits PR-title lint                                                                   | blocking (squash title = commit msg) |

## What Each Gate Proves

- **CodeQL** proves the repo is analyzed by GitHub's SAST pipeline and findings
  flow into the Security tab.
- **Dependency Review** blocks new high/critical dependency risk introduced by a
  PR diff. See [Handling Dependency Review exceptions](#handling-dependency-review-exceptions-allow-ghsas)
  for the narrow, documented `allow-ghsas` escape hatch.
- **gitleaks** blocks newly introduced secrets on `push`/`pull_request`; the
  weekly full-history scan is the backstop for historical drift.
- **Route bundle budgets** prove that no web page's first-load JavaScript grew
  past its limit in that build, and that Next measured every page completely. The
  generated scaffold variants run the same check after their own web build. See
  [Route bundle budgets](../frontend/bundle-budget.md).
- **OSV-Scanner** produces repository-level vulnerability SARIF on the weekly
  schedule without blocking routine development.
- **Trivy** preserves the runner scan and its default scanners/filter policy.
  A separate vulnerability-only migrator scan uploads `trivy-image-migrator`
  SARIF with HIGH/CRITICAL findings that have a fixed version, the runner scan's
  policy. Its full JSON inventory includes all severities, packages and unfixed
  findings. Findings remain report-only;
  scanner errors, missing/malformed reports and mismatched image identity fail.
  Each run creates fresh reports and checks SARIF findings against the JSON inventory.
  The runner report uploads before the independent migrator scan starts.
  Runner category `trivy-image` and its existing secret coverage remain separate.
- **boot-smoke** checks both exact production artifacts built in CI:
  - pass the fast in-image checks;
  - run `prisma migrate deploy` successfully;
  - boot the API and serve `/api/v1/health/ready`;
  - let the Next.js web container return `/` `200`;
  - keep the worker healthy.
    The required lint dependency first checks coherent Prisma versions and both
    frozen graphs. The [migration image guide](migrator-image.md) describes isolated
    dependency upkeep and the residual security risk of API build tooling.
- **Test** is the aggregate for unit+real-Redis, capability extension,
  notification/AI extension, focused API fallback and **API E2E**.
  Independent hosted jobs install frozen dependencies and own their preparation.
  The aggregate runs after dependency failure or skipping and accepts only its
  exact nonempty dependency set with every result `success`. Missing, skipped,
  cancelled or unknown outcomes fail; cleanup cannot turn failure into success.
  The aggregate itself needs no checkout, installation or API receipt.
  The fallback prepares a fresh API receipt and preserves six focused suites and
  twenty-three background-work suites. Separate output roots retain both reports.
  Repeated invocations remain until assertion, condition, natural-exit and cleanup
  equivalence with full API coverage is demonstrated.
- **API E2E** provides full standard PR coverage in separate plan, shard and
  aggregate jobs. Each fresh discovery/execution job installs the frozen lockfile,
  generates Prisma and builds shared. The measured layout uses three built-in shards
  and pnpm dependency caching.
  The aggregate requires successful dependencies and exact-once inventory evidence
  for the same checkout SHA, inputs and current GitHub run/attempt. It normalizes
  actual suite paths across fresh workspace roots and binds them to assignments. Missing, cancelled,
  skipped or forced attempts fail. Artifact names include the workflow attempt;
  the aggregate downloads only that attempt and rejects unexpected artifact directories.
  Reports remain available for seven days.
  The tracked main ruleset requires the stable **API E2E** aggregate from GitHub
  Actions. Individual shard contexts are not required. Applying the declaration
  to live GitHub protection remains a separate owner-authorized repository action.
  The six existing focused suites remain in the fallback feeding **Test**.
  Background-work contracts select 23 original-checkout paths; notification/AI
  extension contracts select nine copied paths. One path overlaps those groups.
  Together with six focused files this names 37 distinct stock paths, not the full
  dynamically discovered API inventory. Extension-copy execution remains separate
  because its source and process context differ. API91 is the current baseline,
  not a fixed maximum; ordinary new files enter discovery automatically.
  Initial layout admission requires Linux cold and cached setup evidence, measured
  runner-minutes and three comparable successful final warm observations.
  The [API E2E budget policy](#api-e2e-budget-policy) defines the accepted limits.
  The workflow target is 15 minutes with a 17-minute ceiling;
  the API target is 12 minutes. The 30-minute measurement timeout is headroom.
  Cold diagnostics retain an isolated pnpm-store option without cache restoration.
  Historical cold setup evidence does not prove successful final-candidate execution.
  Runner snapshots record CPU/RAM, cache status, package/Docker versions, image IDs
  and available runner cgroup metrics. Unavailable metrics remain unknown; runner
  cgroup snapshots do not represent individual container peaks. Ordinary pnpm caching
  is enabled for the final warm candidate; an eligible warm observation requires
  actual cache hits in the plan and every shard. Each job still uses fresh isolated Docker. Measurement snapshots accompany the reports.
  Changes to shard selection require evidence. Full API coverage is declared
  mandatory for PRs; switching to full post-merge coverage requires a separate
  owner policy decision.
- **Test capability extension** runs `pnpm test:capability-extension`: an isolated disposable
  resource variant compiles shared, API and web consumers and exercises
  authorization against PostgreSQL and Redis Testcontainers. The fixture does
  not add a sample product domain to the shipped starter.
- **workflow-lint** checks workflow syntax and hardening rules, and verifies
  that every `uses:` pin matches the real tag commit (including annotated tags).
- **Web E2E** is the declared aggregate check. Live required status is separate. Its plan selects all
  applicable lanes; independent matrix runners execute safety/transport, mocked,
  two isolated path groups and the retained HTTPS host lane with `fail-fast: false`.
  Every lane invokes `node scripts/e2e-ci.mjs <lane>` with CI settings. Matrix
  failure, cancellation or skipping fails the aggregate; the plan must also succeed.
  Grouped runs verify actual Playwright inventory before browser execution.
  All lanes retain browser reports/test results/inventories for seven days.
  Parallelism changes wall time, not coverage or within-stand concurrency.
  The 20-minute lane timeout is emergency headroom, not a runtime target or
  performance proof. Measure cold setup and runner-minutes as well as test time.
  [Local reproduction and isolation](../frontend/testing.md#complete-ci-e2e-locally).
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
- **Scaffolding contract (fast)** — job id `scaffolding-contract`, runs
  `pnpm test:scripts:fast` — scaffold before/after fixtures in `scripts/lib/`
  still match their source snapshot, the fixture-composition invariants
  (no two edit steps target the same file, every scaffold dimension composes
  safely with every other), and
  the `scripts/measure/` baseline-measurement tool's own unit/inventory-
  contract tests plus real, fast failure-path regressions (an install
  exception, a failed command, partial internal verification preserved on a
  failed run). Read-only against the real repo — the disposable repo copies
  a few of these tests create never run a real `pnpm install` inside them,
  only the job's own top-level `pnpm install --frozen-lockfile` — no Docker.
  Fast ownership and operation-inventory checks read the current public working
  tree, including non-ignored untracked files. Mutation fixtures use an
  isolated copy of that tree; generated-project scenarios still start from
  committed `HEAD`.
  A narrow fast assertion check also flags default Console page URLs expected
  without a test-local topology input.
  `test:scripts:fast` is also the first half of the local aggregate
  `pnpm test:scripts` command, so local full verification cannot omit it.
  CI does not repeat this layer inside the parallel full job. Does **not** cover the
  public/private-path ratchet — that is the separate "Observability contract
  (static)" job above. No path filter: a change anywhere in the repo can
  drift a scaffolding fixture (this job exists because exactly that
  happened — `apps/web` and `docs/` changes drifted `scripts/lib/*.mjs`
  fixtures across several PRs with nothing in CI to catch it).
- **Scaffolding contract (full)** — job id `scaffolding-contract-full` is a small
  aggregate that keeps the required display name unchanged. It runs with
  `if: always()` and is green only when the whole `scaffolding-generated-shard`
  matrix result is `success`; failed, cancelled or skipped shards make it red.
  It is the only whole-matrix verdict. The work runs in two parallel shards
  (`Scaffolding generated shard (a|b)`, `fail-fast: false`, own runner, 25-minute
  budget each) over fixed three-scenario lists in
  `scripts/lib/scaffold-ci-shards.mjs`; a fast contract test proves the lists
  partition the six rows exactly. Shard `a` also runs the non-matrix
  `scripts/*.test.mjs` files once; shard `b` runs only the matrix file. Together
  they run the generated-project half of the local `pnpm test:scripts` aggregate
  (`AMCORE_SCAFFOLD_SHARD` selects a shard; unset runs all six, and an invalid
  value or use with the exhaustive matrix fails before any install). Each shard
  uploads `scaffold-diagnostics-<shard>-<run-id>-<attempt>` (best effort, none
  after a hard job timeout). The six independent repositories cover
  the cross-product of multi/single locale routing and Console
  path/host/disabled topology. en/ru and both optional project toggles are
  distributed pairwise; multi- and single-locale host rows verify the distinct
  proxy/static-asset outputs. Every row installs and
  builds once, with typecheck/lint/test profiles assigned to preserve the old
  runtime obligations. There is no path selector: every PR runs all six rows.
  The original eight recipes run unchanged through
  `pnpm test:scripts:exhaustive` in the non-required weekly/manual
  `scaffolding-exhaustive.yml` backstop. Both modes create a fresh worktree per
  row and never share mutable install/build state.

  The job also runs a conservative change selector in **shadow mode**. Selector
  code and its versioned data declaration are extracted from the computed Git
  merge base, so a head change cannot authorize itself. Planning inputs and the
  generated-repository verification closure are separate graphs; unknown/new,
  stale, conflicting, unreadable, A/D/R, membership, workflow, selector, and
  declaration changes fail open to `generatedFull.required: true`. The only
  initial would-skip class is a marker-free modification to an established
  Markdown/CHANGELOG file outside known scaffold seams.

  Shadow output never controls execution: setup, install, and all six generated
  rows remain unconditional, and the fast job remains universal. With
  `if: always()`, each shard appends a bounded summary headed "Shard <id> only —
  not the whole matrix" and uploads `scaffold-shard-evidence-<shard>-<run-id>-<attempt>`
  for 30 days: the versioned selector JSON (`shadow-result.json`) plus
  `shard-scope.json` (shard id, its three scenario names, `scope: "shard-only"`
  and that shard's outcome). Neither file is a whole-matrix result.
  The selector JSON records merge-base provenance, matched/unknown inputs, reasons,
  would-run versus actually-ran state, and that shard's step outcome. The bootstrap
  PR is expected to report `trusted_selector_missing` and choose full because
  its merge base has no trusted selector yet. Missing or invalid output is full.
  The job has only `contents: read`; no skip is enabled in this phase.

- **Scaffolding baseline measurement** (`pnpm measure:scaffold`,
  `scripts/measure/`) is a separate, opt-in maintainer tool — not a CI gate,
  never runs automatically. It re-applies the required six-row covering array
  with instrumentation (copy/install/build/test
  counts, observed-stage wall time, disk usage, generated-tree fingerprints),
  inventories the real plans' source/target operations and exact-copy
  synchronization edges, and statically classifies every
  `scripts/lib/project-plan-*.mjs` transform
  module by its authoring shape (whole-file copy, narrow exact-text block,
  owned/sentinel block, structured config, delete/move, or unclassified with
  a reason). It exists to give the scaffolding engine's own future
  simplification work a measured baseline instead of an estimate. Run it
  locally with `pnpm measure:scaffold` (`--only=coverage-multi-path` to iterate
  on one row) — see the header comment in
  `scripts/measure/run-baseline.mjs` for full usage.

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

## API E2E budget policy

The accepted layout uses three built-in shards on measured Linux x64 runners with
4 CPUs and approximately 16 GB RAM. The declared runner label is `ubuntu-latest`;
measurements must confirm the actual class. Each plan and shard job installs the
frozen lockfile and prepares its own checkout. The aggregate validates downloaded
artifacts without installing dependencies or preparing test infrastructure.
Cache dependencies only; keep Docker and test data isolated.

There are two different time limits:

- **API critical path:** plan start to aggregate completion, including preparation,
  cleanup and artifacts, must stay within 12 minutes.
- **API runner-time:** add the actual durations of the plan, every shard and
  aggregate job. The limit is 2,262 seconds (37:42) per complete observation.
  Parallel job durations count separately. This is machine time, not an invoice.

The complete normal workflow targets 15 minutes and has a 17-minute ceiling,
excluding queue time. Report queue-inclusive waiting time separately.
Job timeouts provide diagnostic headroom; they do not raise these limits.
These are admission limits assessed from retained job timestamps and artifacts.
The aggregate enforces evidence completeness and lifecycle contracts; it does not
apply these time budgets automatically.

Historical baseline hardware was not measured. Its timing remains a historical
reference, not proof of equivalent resources, monetary cost or CPU-normalized
speedup. The absolute runner-time limit does not require reconstructing that host.
Missing physical or cgroup metrics remain unknown; process heap/RSS are not substitutes.
A new serial comparison is an optimization experiment, not a routine delivery gate.

Initial layout admission requires three complete, mutually comparable warm samples.
Compare exact source/configuration/inventory/assignments, measured runner class,
software and resolved container images. Require actual cache hits in the plan and
every shard, exact-once coverage, natural clean exits and matching run/attempt artifacts.
Current normal CI, including Web, generated projects and security, must also pass.

Ordinary feature PRs use the current complete CI gates; they do not repeat layout
admission automatically. Documentation-only changes do not justify another full
local API run. Revisit layout measurements when runner class, sharding, preparation
or lifecycle policy materially changes, or evidence shows a budget/reliability regression.
Record a specific hypothesis before another measurement. A failed or ineligible
sample stops admission; diagnose the smallest failed risk instead of retrying for green.
Runner upgrades, budget changes and a switch to post-merge coverage require an
explicit owner decision. Required-check activation remains a separate repository action.

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
  inside `apps/*` and `packages/*`. Its lint steps use the paired Oxlint and
  ESLint wrapper with an explicit workspace scope. The wrapper changes cwd to
  that workspace before loading its policy. API, web, shared and shared-config
  files therefore use the same policy as their workspace lint command.
  Each staged scope runs fixes, then checks with `--max-warnings=0`.
  The root pattern ignores files owned by workspace policies.
  See [the paired lint configuration](../../packages/eslint-config/README.md)
  for rule ownership and engine-specific exceptions.

  After successful `lint-staged`, the hook prints a read-only size report from
  the final staged snapshot. It marks files at 150 lines and functions at 30
  lines for review, including test helpers but excluding direct
  `describe`/`test`/`it` and Playwright `test.describe` suite/case callbacks.
  Ordinary callbacks such as `test.step` remain visible. The report is
  advisory: a size marker or unavailable report cannot fail the commit, and CI
  has no size gate. Both lint engines remain blocking on their assigned rules, including
  `--max-warnings=0`; size is deliberately outside that invocation. See
  `CONTRIBUTING.md` → _Size
  review advisory_ for the handoff decision required for each marker.

**Do not add a new lintable workspace under `apps/*` or `packages/*` without
also adding a matching `lint-staged` pattern** in the root `package.json`
using the paired wrapper with its workspace scope, or its staged files
will silently skip policy checks locally (formatting still runs) while still being
correctly caught by CI's `pnpm lint`. This is exactly the gap found and fixed
2026-07-18: `packages/shared` had no `eslint.config.mjs`/`lint` script at all
(never linted anywhere, not even in CI) until that gap surfaced 19 real,
long-accumulated lint violations on first run, and the pre-commit hook's
`*.{ts,tsx,js,jsx}` pattern ran ESLint from the repo root — which silently
skipped every file under `apps/**`/`packages/**` because the root config
ignores those paths, and `--no-warn-ignored` suppressed even the "file was
ignored" notice. `pnpm lint`/`pnpm --filter <workspace> lint` was and remains
the authoritative local check; run it before relying on a clean commit if
you're touching a workspace's lint policy or adding a new lintable
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

OSV runs only on the weekly schedule. A successful pull-request workflow skips
that job and does not prove the new binary works. Before changing its pin, verify
the downloaded binary's checksum and version, then run the existing recursive
command against root and nested lockfiles. Validate the resulting SARIF report.
Keep these results separate from tests that simulate scanner exit codes.

OSV exit codes `0` (clean) and `1` (findings) permit SARIF upload. Other exit codes
fail the job; a missing or malformed report must not become a successful upload.
Keep the schedule, recursive scan, upload category and report-only findings policy
when refreshing the binary. An older alert can still apply if its affected
package version remains installed. Duplicate alerts from different scanners do
not represent independent vulnerabilities, and a green report-only scan does
not prove that an image contains no vulnerable packages.

### Transitive dependency exceptions

Prefer the versions supported by each parent package. Before removing an override,
check the parent's published dependency range, current advisories and the actual
installed consumer. Use normal pnpm resolution and review the complete lockfile
change. An override removal does not require updating every compatible dependency
already retained by the lockfile.

Swagger 12.0.2 selects js-yaml 5.4.2; Prisma 7.10.1 selects mysql2 3.24.4.
MCP SDK 1.31.0 accepts Hono node-server 1.19.17, retained in the ordinary lockfile.
These paths no longer need overrides. The web development tool shadcn uses MCP
stdio, not the Hono HTTP transport. This does not certify unrelated package paths
or replace source and deployed-image scans. Recheck advisory ranges before a
future dependency update; a package's minimum supported version can be vulnerable.

### Dependency freshness report

Dependabot handles patch/minor npm + action bumps and (per repo, see
[_Strict security setup_](#strict-security-setup-after-forking)) opens security
PRs — but it does not surface **semver-major** npm updates (ignored in
`dependabot.yml`), Docker base-image **digest drift**, or newer **curl-pinned CLI
tool** releases. It also does not bump the root `packageManager` pnpm pin or the
Node.js major selectors; the report has a **Toolchain** section for both (pnpm
versus the registry; Node majors versus the LTS, Current and next-LTS schedule).
Move the pnpm pin in one PR: root manifest, both Dockerfiles, the stand installer and
`docker/migrator` together (`scripts/lib/toolchain-pins.test.mjs` checks they agree).
The `dependency-freshness.yml` workflow closes that visibility
gap: on a weekly schedule (and on-demand via `workflow_dispatch`) it runs
`scripts/dependency-freshness.mjs` and **upserts a single tracking issue** (label
`dependency-freshness`, edited in place) listing all four categories (semver-major npm updates, Docker digest
drift, curl-pinned tool releases and the toolchain). It opens no PRs and is
a report only — triage each item and bump deliberately. For semver-major updates,
use a separate PR, read the upstream migration notes/changelog, record any
intentional deferral in the product's own backlog or issue tracker, and run the
full relevant CI before merging.

The root workspace explicitly sets `minimumReleaseAge: 1440` and
`minimumReleaseAgeStrict: true`. It also sets
`minimumReleaseAgeIgnoreMissingTime: false`: a registry entry without a publication
time fails with `ERR_PNPM_MISSING_TIME`. Fix the registry metadata or mirror;
waiting alone cannot establish an unknown publication time. The isolated migrator
retains its separate strict/default-age policy; this change does not tighten its
missing-time setting. Strict mode prevents fresh resolution from
persisting age exceptions. pnpm 12 re-checks every lockfile entry during `pnpm install --frozen-lockfile`. A lockfile that holds a version
published less than 24 hours ago therefore fails the install step with
`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`, even though the lockfile matches the
manifests. This happens when Dependabot or a contributor adds a very fresh package.
Wait until every offending package is 24 hours old, then rerun the complete CI
workflow with **Re-run all jobs**. Do not rerun individual or only failed jobs. Do not set
`trustLockfile`, lower `minimumReleaseAge` or add an exclusion to make the job pass:
each one switches off the protection against freshly published malicious versions.

Both npm entries in `dependabot.yml` explicitly set a three-day cooldown for
ordinary version updates. Groups, schedules and major-version ignores still apply.
Security updates can open immediately; installing their packages still follows
the 24-hour rule. An urgent exception needs a separate maintainer decision.

### One delayed Dependabot CI retry

`dependabot-retry.yml` checks hourly at minute 17, or manually from `main`.
Schedules can be delayed. It retries the `CI` workflow once when all these hold:

- The open PR belongs to `dependabot[bot]`, stays in this repository and targets `main`.
- Its latest applicable PR run failed on the first attempt at least 25 hours ago
  and less than 30 days ago (the GitHub rerun window).
- The run's head and base match the current PR. No newer run has replaced it.
- A step named `Install dependencies` failed. No executed test/build job failed
  after installation, and no job was cancelled or remains running.

The controller reads GitHub job metadata. It does not diagnose package ages from
logs, so a network-related install failure may also receive this one retry.
It repeats the whole workflow to keep API/scaffold plans and shard evidence in
the same attempt. Successful jobs therefore run again too. The installation
checks the real policy again; no lock, age exclusion or permissions are changed.

The controller loads only trusted `main` code, installs no dependencies and reads
no PR code, caches or artifacts. Only its job has `actions: write`; PR build jobs
keep their existing permissions. Controller runs serialize. A changed head/base,
a newer run, or any prior manual/automatic attempt makes the run ineligible.
It checks the age window again immediately before requesting the retry.
A candidate-specific GitHub refusal (404, 409 or 422) produces a warning and does
not stop other PRs. Permission, rate-limit and service errors still fail the controller.
It never approves or merges a PR.

If the repeat fails, inspect the new failure and fix it normally. Human/fork PRs
and stale-base runs need manual triage or rebase. Always use **Re-run all jobs**
for a manual CI retry so every shard belongs to the new attempt. Runs at least
30 days old cannot be rerun: update or rebase the PR branch to create a new
current-head/base CI run, then inspect that run. The controller becomes
active only after this workflow reaches `main`; local mocked tests do not prove
hosted scheduling or rerun activation.

The report also has a **Dependabot health** section. GitHub kills a Dependabot
update job after a fixed 55 minutes (it cannot be extended) and a killed job opens
**no PR**, so the only symptom is silence. The section warns when the latest
`npm_and_yarn in /` job did not finish, or when about 40 or more packages are
behind inside their major (a job prepares one update per outdated package, roughly
40 s each here). The root npm entry in `dependabot.yml` therefore runs twice a week
(Mon and Thu, 06:00 UTC) to keep each backlog small; if the warning appears, update
the backlog by hand once instead of waiting for the next run.

Forkers can keep this stack lean:

- keep GitHub-native features first;
- prefer report-only scans where blocking does not buy meaningful signal;
- block only on checks that protect the current change set or workflow integrity;
- re-use the production image for image scanning and boot-smoke rather than
  rebuilding separate artifacts.

## Adding tests and changing Test groups

See [adding tests](adding-tests.md) for discovery, local commands and CI ownership.
New tests in an existing discovered family do not require another focused CI call.
A new job or test family requires an explicit aggregate, inventory and docs update.
The required `Test` name is retained; tracked workflows do not prove live protection.
Scheduling changes require whole-workflow timings and hosted runner-minute evidence.
Separate queue, setup, cache and container costs; do not infer speed from a shorter step.
Rollback restores the previous sequential Test graph, focused calls, fresh prepare
and associated docs together. It does not migrate dependencies or persistent data.
