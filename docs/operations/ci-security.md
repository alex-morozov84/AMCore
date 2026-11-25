# CI Security Automation

AMCore's GitHub-native CI security stack is intentionally lean: blocking gates
for new problems, report-only scans where review is enough, and a small amount
of workflow self-hardening to keep the example forkable.

## Choose automatic checks for a product

Before the first push, decide how your team accepts changes. Then choose what CI
should check automatically. The two choices are independent.

| Owner's choice                             | Set `mode` in `ci/product.json` | What CI checks                                                      |
| ------------------------------------------ | ------------------------------- | ------------------------------------------------------------------- |
| Check what could have broken (recommended) | `normal`                        | Checks selected for the change and product settings.                |
| Check everything that applies every time   | `full`                          | The full applicable plan. Main can credit a matching successful PR. |
| Keep only quick checks                     | `heavy-off`                     | Applicable quick checks, migration history and secret scanning.     |

Keep `"version": 1` in the file. For example, use `{"version":1,"mode":"heavy-off"}`
only after the owner chooses reduced coverage. Unit tests can pass even if the
browser loses the user's session after sign-in. Reduced CI skips that browser test.

The first push to an empty independent repository uses the saved choice. In a
GitHub Fork, enable Actions first. The initialization PR uses the starter base's
check mode. The product's saved choice takes effect on the first push after
merge. Later mode changes follow the same PR-base rule. Use an independent
repository for a private product.

Open **Actions → CI → the run → Summary**. Read **CI execution selection** for
the saved, proposed and run modes. The selected groups are in `effective`. The
summary links the exact PR attempt when main credits earlier checks. Open **Jobs**
to confirm execution and read logs. A green reduced result covers the required
checks in that reduced plan. It leaves the build, browser and API runtime
scenarios, and disabled scans unverified. Check **Security Scans** separately for
the Gitleaks result. CodeQL and scheduled OSV report a policy skip when disabled.

To check a version once, open **Actions → CI → Run workflow**. Select its branch,
enable **Run the full applicable plan once**, and enter its exact commit SHA.
The workflow rejects a different checkout. It executes the applicable plan
without reusing PR results. The saved mode stays the same. This run does not
satisfy the required check on an ordinary PR. Use **CodeQL** and **Security
Scans** separately to request their manual scans on the same SHA, if your
repository has the necessary code-scanning access. Inspect both run summaries.

To restore automatic selection, change `mode` to `normal` and deliver it using
your team's workflow. Check the next main run's Summary and Jobs.

In AMCore PR #704, the CI workflow took 19 minutes 17 seconds from the start
of CI selection to the end of CI required. The 39 jobs used 203 minutes
6 seconds of machine time in total because jobs ran in parallel. These
figures exclude other workflows and billing rounding. Private
repositories draw runner usage from the owner's account allowance and may incur
charges. GitHub Free includes $12 of eligible compute per account per month.
That covers about 2,000 minutes on standard Linux x64 at $0.006 per minute
if other eligible usage does not draw from the same allowance. Standard
GitHub-hosted runners are free in public repositories.
[Included usage](https://docs.github.com/en/billing/reference/product-usage-included).
[Example run](https://github.com/alex-morozov84/AMCore/actions/runs/45561653782/attempts/1)
· [Runner rates](https://docs.github.com/en/billing/reference/actions-runner-pricing)

- **One run.** Open **Actions → workflow → run**. The job list shows execution
  times. In a private repository, open **Run details → Usage** for billable
  minutes on GitHub-hosted runners. GitHub rounds each job up to a whole minute.
  [View job execution time](https://docs.github.com/en/actions/how-tos/monitor-workflows/view-job-execution-time).
- **One PR.** Start with the PR's **Checks** tab. Use **Actions** to find
  runs for earlier PR commits too, including failed runs. Add the billable
  minutes of jobs that ran for each PR commit. For a partial rerun, add only
  the jobs that ran again. For the full cost of delivery, also add the workflow
  runs on the merge commit. Multiply the minutes for each runner type by its
  rate to estimate the compute cost. Any extra charge depends on the account's
  remaining included usage.
- **Whole account.** Open **Settings → Billing & Licensing → Usage** in the
  account or organization that owns the repository. Select **Actions**. Filter by
  repository to see its share, or clear that filter to see the account total.
  [Account usage](https://docs.github.com/en/billing/how-tos/products/view-productlicense-use).

The standard Linux x64 machine has 2 CPUs and 8 GB of RAM in private repositories,
versus 4 CPUs and 16 GB in public repositories. The public PR #704 example shows
how to read the numbers. The time and cost of a full private product CI run have
yet to be measured.
[GitHub-hosted runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

On GitHub Free, a private product can run lint, tests, builds and Gitleaks when
their triggers and the selected mode apply. GitHub CodeQL code scanning and
GitHub Dependency Review for private repositories require GitHub Code Security
on an eligible Team or Enterprise plan. The OSV scanner can run on Free, but
its GitHub code scanning upload can fail without Code Security. The same
restriction applies to the Scorecard upload. Trivy can save reports as workflow
artifacts without code scanning. [GitHub security plan features](https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security).

For individual checks on your own machine, see the
[local test commands](../frontend/testing.md#commands). For a machine you manage,
see [GitHub's self-hosted runner guidance](https://docs.github.com/en/actions/reference/security/secure-use#hardening-for-self-hosted-runners).
We verified full CI on a standard GitHub-hosted runner in a public repository.
We will verify it on a standard GitHub-hosted runner in a private repository with the first real private product.

## Current Gates

| Workflow                | Trigger                                 | Tooling                                                                                             | CI behavior                          |
| ----------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `codeql.yml`            | `push`, `pull_request`, weekly schedule | CodeQL (`javascript-typescript`, `build-mode: none`)                                                | report-only, uploads SARIF           |
| `dependency-review.yml` | `pull_request`                          | GitHub Dependency Review                                                                            | blocking on `high+`                  |
| `security-scans.yml`    | `push`, `pull_request`, weekly schedule | gitleaks CLI, OSV-Scanner CLI                                                                       | gitleaks blocks; OSV is report-only  |
| `ci.yml`                | `push`, `pull_request`                  | Route bundle budgets after the web build (`pnpm check:route-budgets`, Build job)                    | blocking                             |
| `ci.yml`                | `push`, `pull_request`                  | Trivy CLI + boot-smoke                                                                              | Trivy report-only; boot-smoke blocks |
| `ci.yml`                | `push`, `pull_request`                  | Observability contract — static (`scripts/observability-contract/`, folded into the `promtool` job) | blocking                             |
| `ci.yml`                | `push`, `pull_request`                  | Observability contract — live (real Prometheus/Alertmanager/Grafana boot)                           | blocking                             |
| `ci.yml`                | `push`, `pull_request`                  | Script contracts (`pnpm test:scripts`: tooling unit and contract tests, no Docker)                  | blocking                             |
| `workflow-lint.yml`     | `push`, `pull_request`                  | actionlint, zizmor, action pin verifier                                                             | blocking                             |
| `pr-title.yml`          | `pull_request`                          | Conventional-Commits PR-title lint                                                                  | blocking (squash title = commit msg) |

## Aggregate CI gate

`CI required` runs after every job in `ci.yml`, including Web E2E and Storybook.
It validates the selector's source, run, attempt and effective execution plan.
Every selected job must succeed. Every explicitly unselected leaf must report
`skipped`. Missing or extra results, unexpected execution, failure, cancellation
and an unjustified skip block the gate. Test and API E2E use the same admission
logic. Selected API E2E still requires complete artifacts and natural exits.

### Selection modes

The ordinary PR workflow reads the role from `PROJECT_CONTEXT.md` and the
saved mode from `ci/product.json` (version 1). Missing policy means `normal`.
A PR uses the base mode and validates the proposed mode. The proposed mode
takes effect on the next push after merge. An ordinary PR cannot change the
repository role.

- `normal` uses the complete Git diff and the pinned path filter. A change
  limited to discovered API E2E specs runs the complete API E2E chain and
  static gates. Adding production API code brings back the relevant runtime
  checks. Unknown paths, shared mechanisms, source merges and incomplete
  classification select the broad applicable set.
- `full` selects every applicable job in the workflow. The starter retains
  its extension and browser variant checks. Products use their settings
  for the standard, disruptive and optional host Console browser groups.

CI collects Playwright cases only when it selects browser checks. The
checkout must match the PR event's merge parents. CI collects the base
under the same product settings and retains every applicable base case.
Real-stack tests and applicable host Console tests join the plan automatically.
The mocked and server-mocked projects share the configured mocked job.
It uses the source settings and prepares local HTTPS when a surface uses a
separate host.

When a product merges an AMCore update, CI checks the Git history and contents
of changed browser specs. An existing spec may pass the executor check without
a configured lane when its base contents match the common AMCore ancestor and
its merged contents match the incoming AMCore file. Verify the source and
release SHA separately using [the update guide](updating-a-fork.md).
With Console disabled, CI can accept an inherited change to its working-console
specs. CI still requires both the Console page and its API to return 404 after
an operator signs in.

A new or product-modified spec needs an executor. If CI cannot assign one, it
stops the plan and names the file. Check the spec's directory and prerequisites
against the supported test groups. Keep the settings the product is intended
to ship.
See [Writing a browser test for the product settings](../frontend/testing.md#write-a-browser-test-for-the-product-settings).
Selected browser cases must yield successful results from the same run
and attempt. Skips use a named prerequisite that the planner verifies against the settings.
An applicable case from the base stays mandatory. Review applicability declarations independently when updating the starter.
Use settings where old and new tests agree, or apply the declaration first
to a reviewed experimental base. Then test the settings change. A base
that still collects a case as mandatory cannot authorize its omission.
API E2E retention checks suite files. Review changes to assertions inside a
suite file as ordinary test changes.

### CI after delivery

CI tests a PR against its base. On main, **CI selection** credits a successful
PR only when GitHub associates the delivered commit with that PR and CI can
verify the same base, tree, mode and applicable plan. The **CI required** job
checks the decision. The summary links the credited run and attempt. Test
families and their preparatory jobs stay skipped for verified delivery.
A squash can reuse the PR result. CI verifies that the previous main commit
is the first parent of the delivered commit. A push of several commits in
sequence runs the applicable checks.
CI also checks the changed-file classification on main. If the current
classification is unavailable or requires checks beyond the PR plan, CI runs
the applicable main plan. If the initial path filter fails, CI discards its
outputs and uses the broad plan. If the final recheck fails after tests have
been skipped, CI required fails. A saved `full` mode can reuse a matching full PR.
An explicit one-off full run always executes its plan.

A direct push, missing evidence, changed base or untrusted CI change runs the
applicable checks on main immediately. Unknown impact selects a broad plan.
The summary shows the reason. Missing baseline data can block a required
comparison. Resolve the unavailable comparison before treating main as verified.

Image smoke saves each successful Trivy scan immediately in its own artifact.
Find `runner-trivy-sarif` and `migrator-trivy-sarif` in the run. A later
migrator failure leaves the runner report available. External PRs retain
the artifacts only. Internal
runs upload to Code Scanning in public repositories. In private repositories,
set `AMCORE_TRIVY_CODE_SCANNING=true` only after confirming Code Scanning access.
An enabled upload that fails stays visible. A credited main run links to the
PR evidence, so it does not add new image SARIF results to the main branch's
Code Scanning view. Open the credited PR run for the image reports.

Standalone checks retain their own triggers. Workflow Lint independently
checks the workflows on main. Gitleaks scans the delivered commit
range. CodeQL can publish findings for main even when its PR workflow skipped a
fork. Scorecard reports repository posture. There is no scheduled full test
run by default. A release still verifies the chosen commit and the images
produced from it. See [the fork update guide](updating-a-fork.md).

Private repositories consume the owner's included or paid Actions minutes.
Check the live plan and rules before choosing strict. With no supported branch
protection, main CI can report a failed direct push after it lands. It cannot
prevent that push. Keep the available independent scans. Confirm PR protection
and the chosen merge methods in GitHub after setup. For a new private strict
profile, the script omits CodeQL and Dependency Review from the required list
until the owner verifies those features. It preserves existing required checks.
Verify branch rules and scan availability in the repository settings.

### Review changes to CI itself

The PR workflow evaluates scripts from the PR merge checkout. Reading the
saved mode from the base does not make the workflow or its scripts trusted.
Changes to workflows, actions, path filters or selector and result scripts
require independent review against the exact protected base and PR head.
Confirm the required status and merge enforcement in the repository settings
before enabling this workflow. A green status from the proposed workflow is
evidence for its candidate behavior. Independent enforcement requires a
required check or review rule controlled outside the proposed PR. Keep
workflow changes together with their plan and result checker on rollback.

### PR, post-merge and release evidence

The PR tests its merge checkout. After a squash, the commit ID changes.
See [CI after delivery](#ci-after-delivery) for the conditions under which
main credits the PR and for the independent security checks.
A release needs the published API, migrator and web image digests, their
build provenance and staging evidence for those exact digests.

To roll back exclusions, switch the saved mode to `full` in a reviewed
change.
Return to `normal` in a reviewed change. If the selector or required gate
itself cannot run, revert the workflow and its matching gate together.
Keep the required checks and branch protection in place.

### Add the requirement to an existing repository

Use installed GitHub CLI and `jq`, repository-admin access and separately approved
publication, CI, merge and ruleset changes. Do not run the full setup script to
make this narrow change. For a new fork, use [strict setup](#strict-security-setup-after-forking).
The tracked publisher15368 is the GitHub Actions ID already used for API E2E;
confirm the new check's own publisher before applying that declaration.

1. Deliver the aggregate through a PR under the old protection. Preserve every
   existing job and requirement. Keep its exact head/base commits and successful
   workflow/run attempt. Merge requires its own approval.
2. Read current protection and the new check. Replace the following placeholders
   with the actual repository, PR head commit and repository-owned main ruleset ID.
   Store responses outside the repository. A tracked JSON file is not live state.

   ```sh
   ci_repo='<owner>/<repo>'
   ci_head='<full-PR-head-commit>'
   ci_rule='<main-ruleset-id>'
   ci_evidence=$(mktemp -d)
   gh api "repos/$ci_repo/rules/branches/main" > "$ci_evidence/effective.json"
   gh api "repos/$ci_repo/rulesets/$ci_rule" > "$ci_evidence/before.json"
   gh api --paginate "repos/$ci_repo/commits/$ci_head/check-runs?per_page=100" > "$ci_evidence/checks.json"
   ```

   Verify that this active rule applies to main. Preserve other effective or
   inherited rules. Identify `CI required` by name, `head_sha`, `app.id`, check ID,
   `details_url` and the associated workflow/run attempt. Other successful checks
   do not prove this new check's publisher. If it has not run, stop here.

3. Set `ci_app` to that observed numeric app ID. Choose `ci_strict=true` only with
   approval to enable strict when the live value is false. Preserve existing
   strict=true. If the effective rule is ambiguous, obtain a reviewed plan first.
   Prepare the narrow request without changing the old contexts or pins:

   ```sh
   ci_app='<observed-numeric-app-id>'
   ci_strict=true
   jq --argjson app "$ci_app" --argjson strict "$ci_strict" '
     {name,target,enforcement,conditions,bypass_actors,rules} |
     .rules |= map(if .type == "required_status_checks" then
       .parameters.strict_required_status_checks_policy = $strict |
       .parameters.required_status_checks |=
         (if any(.[]; .context == "CI required") then
            error("Context already exists: verify it instead of adding another")
          else . + [{context:"CI required",integration_id:$app}] end)
       else . end)
   ' "$ci_evidence/before.json" > "$ci_evidence/request.json"
   ```

   Review the semantic diff: only the new context and, if separately approved,
   strict false→true may differ. Require exactly one intended status-check rule.
   Leave all old checks, pins, conditions, bypass and enforcement unchanged.

4. Agree a short exclusive administration window with other maintainers. Re-read
   the rule immediately before the approved write. If `updated_at` or any reviewed
   field changed, rebuild and review the request. GitHub's PUT is not an atomic
   compare-and-swap; do not claim that re-reading eliminates concurrent updates.

   ```sh
   gh api "repos/$ci_repo/rulesets/$ci_rule" > "$ci_evidence/latest.json"
   diff -u "$ci_evidence/before.json" "$ci_evidence/latest.json"
   # Proceed only after reviewing an unchanged rule and obtaining write approval.
   gh api --method PUT "repos/$ci_repo/rulesets/$ci_rule" --input "$ci_evidence/request.json"
   gh api "repos/$ci_repo/rules/branches/main" > "$ci_evidence/after.json"
   ```

   Confirm the effective context/app pin, strict policy and every old protection.
   A successful PUT alone does not prove the rule applies to main.

### Verify failure, pending results and cancellation

Use separately approved disposable validation PRs. Keep the normal aggregate
step with `CI_RESULTS: ${{ toJSON(needs) }}` unchanged. After it, add one temporary
step only on the validation branch:

```yaml
- name: Disposable aggregate failure witness
  env:
    CI_RESULTS: '{}'
  run: node scripts/ci-required.mjs
```

Run `node --test scripts/lib/ci-required.test.mjs scripts/lib/script-contracts-ci.test.mjs`
on that fault diff before publishing. Do not weaken their assertions. This added step must fail the aggregate
while other required checks succeed. Never merge the temporary step into main.

Collect `gh pr checks PR_NUMBER --required`, `gh pr view PR_NUMBER --json headRefOid,baseRefOid,mergeStateStatus,statusCheckRollup`
and the exact commit's check-runs. Record each required context, app, conclusion
and pending/missing result. Also exclude stale base, unresolved conversations and
other failing requirements as the reason for blocking. A generic blocked result
with another failed check does not isolate the aggregate's effect.

Observe pending admission while an approved validation run is still executing its
dependencies. If it finishes before observation, pending admission remains unproved;
do not trigger another run without its own authorization and budget.
For cancellation, obtain explicit permission
to rerun/cancel the named validation workflow. Use `gh run cancel RUN_ID`, then
verify terminal jobs, cleanup and actual merge admission. A skipped GitHub check
can count as successful. If cancellation permits merge, protection is unproven:
retain old requirements, fix the specific defect and do not enable conditional jobs.
Do not attempt a destructive merge probe or automatically rerun a failed CI.

### Recover without overwriting other protection

First correct the aggregate while retaining the old requirements. If emergency
removal of only its new live requirement is approved, read a fresh ruleset and
remove only the matching context/app pair from that fresh request. Review the
semantic delta, coordinate the administration window, write and read back as above.
Do not restore `before.json` wholesale over another maintainer's changes. Do not
silently revert an independently approved strict policy. Preserve evidence of both
the failure and recovery; publisher/protection verification remains incomplete
until the intended checks and effective rules agree.

## Lighthouse evidence admission

The Web E2E workflow declares explicit Lighthouse owners and exact current-run/attempt
evidence checks in its existing aggregate. See [the audit procedure](../frontend/testing.md#lighthouse-audits).
The planner independently lists every expected page on the run Summary. Owners
link downloadable native HTML; absent owner output leaves its expected pages incomplete.
Each owning lane reuses its admitted build/stack; non-owners record N/A.
Missing audits, wrong artifact identity, invalid hashes or earlier lane failures keep the aggregate red.
The 40/25/5-minute job ceilings and15-minute audit phase require hosted cold/warm
admission and actual artifact upload/retrieval before adoption. Configuration alone is
not proof of cost, successful transfer or live branch protection. Seven-day safe artifacts
exclude credentials and private fixture state. Publication, CI execution and repository
settings retain their separate authority boundaries.

## Docker Hub mirror

Every CI job that builds or runs containers starts with the step `Docker Hub mirror`
(`scripts/docker-registry-mirror.sh`). It sets `mirror.gcr.io` as a registry mirror of
the runner's Docker daemon, so one setting covers `docker build`, `docker run`,
`docker compose` and Testcontainers. The daemon falls back to Docker Hub when the
mirror cannot answer. The mirror is an optimization: if the setup fails, the script
restores the original daemon config and the job continues on plain Docker Hub with a
warning annotation `Docker Hub mirror: NOT configured`. It fails the step only when
Docker itself does not come back. A green job alone does not prove the mirror is
active; check the run summary line `Docker Hub mirror: active`. The cause was a Docker Hub
`502 Bad Gateway` that failed whole jobs after a few minutes, in places with no retry.

Add the same step, right after checkout, to any new job that pulls images. Digest-pinned
references are served through the mirror unchanged. The mirror helps only with
Docker Hub images; images from other registries (for example `ghcr.io`) are pulled as before.
The stand also retries its own `postgres` and `redis` pulls on registry 5xx and timeouts
(`scripts/stand/registry-pull.mjs`); that protects local use, where this step is absent.

## Docker E2E disk preparation

GitHub [lists 14 GB SSD for standard Linux runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners); actual available space varies.
Do not depend on the larger disks observed on some machines. Every job that builds
application images calls `scripts/free-runner-disk.sh` after checkout: Docker-backed
Web E2E lanes (all but `mocked`, including `safety`), production image smoke and live
observability. New image-building jobs must keep this preparation. Jobs that only
pull small Redis/Postgres images do not need it.

The default call removes the unused Android SDK (`/usr/local/lib/android`) and
system .NET SDK (`/usr/share/dotnet`). No application job uses them; the runner's
bundled runtime stays intact. Actual deletion time and reclaimed bytes vary. The
script reports available bytes and inodes before and after; deletion/report errors
remain failures. It does not prune Docker images or alter application readiness.

Only `path-standard`, `path-disruptive`, `staff-path-oauth`, `staff-oauth`,
`staff-console-path`, `staff-host`, `host`, `setup-cli`, `setup-console`,
`staff-invitation`, `support-mail-path` and `support-mail-host` may skip deletion
through the explicit `--lane` option. Admission requires known GitHub-hosted Ubuntu 24.04 x64, local
Docker `overlay2`, and one filesystem for workspace, temporary files, Docker data
and application root. Available bytes must satisfy BOTH 80 GiB and
40 GiB plus 10% of filesystem capacity. Free inodes must satisfy BOTH 80% of total
and 2,000,000 plus 5% of total. All comparisons use exact integer arithmetic.
The 40 GiB allowance comprises 32 GiB for workload growth and 8 GiB reserve;
these are conservative policy allowances, not measured peak guarantees. The eligible
staff profiles retain one managed stack and the same five build services. Their
resolved configuration checks cover each profile separately, including host
placement, OAuth preload and conflicting readiness settings. Eligible mail
fixtures reuse the API image for their collector, with a read-only filesystem,
no build, no mounted volume and no published port. Validation rejects changed
collector conditions. The shared `organization-provisioning` fixture retains
these safety checks but does not receive SDK cleanup admission.

The managed disk-readiness contract is root path `/` with used-space threshold
`0.9`. Managed Compose generation explicitly sets `HEALTH_DISK_THRESHOLD_PERCENT`
to string `'0.9'` for API and worker; validation rejects a missing or changed
resolved setting before services start. The early probe uses the same small
contract without installing application dependencies. Its logged contract is a
configuration guarantee, not a live container observation.

Compatible dependency, lockfile and base-image updates do not require renewed
fingerprints or disable admission. Tests check the actual resolved Compose model,
installed Nest Config/EnvService conversion and readiness forwarding, alongside
update compatibility and unsafe-capacity refusal. Genuine incompatibilities remain
CI failures. Ordinary API deployments retain their configurable health threshold;
managed stands keep the existing default explicitly. Host overrides retain deletion.

The isolated probe has a five-second deadline and terminates its process group.
It logs the branch, primitive capacity counters and admission reason. Unknown or
unsupported identity/storage/configuration, malformed counters, filesystem mismatch,
probe failure or timeout retains deletion. Safety, smoke, observability and other
lanes keep deletion. A no-option call always retains the original behavior.

The API checks disk use against `HEALTH_DISK_THRESHOLD_PERCENT` (default 90%).
A nearly full runner can therefore produce an unhealthy API even before ENOSPC.
Read the decision and `df` output when diagnosing a failure. Keep the readiness
threshold intact; successful SDK removal alone does not prove sufficient capacity.
Use actual phase/minimum observations in required delivery runs before expanding
the eligible lanes. Sampling does not establish an instantaneous peak or guarantee
against arbitrary future workload growth. Reassess capacity when the application grows.

## What Each Gate Proves

- **CodeQL** proves the repo is analyzed by GitHub's SAST pipeline and findings
  flow into the Security tab.
- **Dependency Review** blocks new high/critical dependency risk introduced by a
  PR diff. See [Handling Dependency Review exceptions](#handling-dependency-review-exceptions-allow-ghsas)
  for the narrow, documented `allow-ghsas` escape hatch.
- **gitleaks** blocks newly introduced secrets on `push`/`pull_request`; the
  weekly full-history scan is the backstop for historical drift.
- **Route bundle budgets** prove that no web page's first-load JavaScript grew
  past its limit in that build, and that Next measured every page completely. See
  [Route bundle budgets](../frontend/bundle-budget.md).
- **OSV-Scanner** produces repository-level vulnerability SARIF on the weekly
  schedule without blocking routine development.
- **Trivy** preserves the runner scan and its default scanners/filter policy.
  A separate vulnerability-only migrator scan uploads `trivy-image-migrator`
  SARIF with HIGH/CRITICAL findings that have a fixed version, the runner scan's
  policy. Its full JSON inventory includes all severities, packages and unfixed
  findings. Findings remain report-only;
  scanner errors, missing/malformed reports and mismatched image identity fail.
  Each image smoke job creates fresh reports and checks migrator SARIF findings against its JSON inventory.
  The job saves the runner report before the migrator scan starts. After a credited
  merge, open the PR run linked from **CI selection** on main for both reports.
  Runner category `trivy-image` and its existing secret coverage remain separate.
- **boot-smoke** checks both exact production artifacts built in CI:
  - pass the fast in-image checks;
  - run `prisma migrate deploy` successfully;
  - boot the API and serve `/api/v1/health/ready`;
  - let the Next.js web container return `/` `200`;
  - keep the worker healthy.
    The required lint dependency first checks coherent Prisma versions and the
    migration package in the shared frozen lock. The [migration image guide](migrator-image.md) describes
    dependency upkeep and the residual security risk of API build tooling.
    The same Docker smoke job declares native migration cancellation, roles/TLS,
    history and recovery checks. Its negative controls test network isolation,
    interrupted verification, independent cleanup and missing lifecycle protections.
    It also verifies real database/file archive recovery and strict load-test
    migration TLS configuration with separate recovery journals.
    Cleanup for these journaled checks runs independently with `always()` and
    cannot erase an earlier failure. The same job runs blocking Linux tests for
    Caddy test-entry removal without changing database data and private model-file
    ownership for a non-root operator.
- **Test** is the aggregate for unit tests, real-Redis integration, capability extension,
  notification/AI extension and **API E2E**.
  Independent hosted jobs install frozen dependencies and own their preparation.
  The aggregate checks out the source and verifies the selection plan against
  the same attempt. Each selected dependency must succeed. Each dependency
  excluded by the plan must report skipped. Missing or cancelled results
  fail. The API E2E aggregate verifies the API reports separately.
  Standard API suites run once through full API coverage. The former focused and
  background-work CI job repeated the same source and per-suite supervision without
  a distinct application scenario. Controlled readiness and shutdown defects remain
  detectable by the retained suites; strict inventory, process and aggregate guards
  remain required. Removing the second execution loses independent repetition and
  its separate artifact, not the original assertions. Focused local commands remain
  available for diagnosis.
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
  Background-work suites remain in complete standard API discovery. The separate
  notification/AI extension fixture still executes copied source to prove registration
  and upgrade behavior; it is not replaced by the stock API run. The inventory is
  discovered dynamically rather than limited to a fixed historical suite count.
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
- **Test capability extension** runs `pnpm test:capability-extension` on the starter.
  Its fixed patch adds a disposable resource, compiles shared/API/web consumers,
  and tests authorization against PostgreSQL and Redis Testcontainers.
  It also runs the member access journey and the catalogue copy test by name,
  each with a minimum reported count.
  No sample product domain ships in the starter. Normal product edits can break
  the patch's exact source anchors without breaking authorization.
  Exactly one canonical ``- **Mode:** `downstream-product` `` line in
  `PROJECT_CONTEXT.md` makes the command warn in the log and step summary,
  then succeed before copying or running tests. Typo or duplicate Mode lines
  leave the check enabled. CI in the canonical `alex-morozov84/AMCore`
  repository rejects this downstream declaration to prevent accidental disabling.
  Products retain inherited tests, but a green `Test` no longer proves the full
  new-module extension path on their code. Product-owned PostgreSQL tests must
  cover roles, organizations, rows, DENY, fields and API keys; see
  [extend a product](../auth/capability-catalogue.md#extend-a-downstream-product).
  The job and `Test` aggregate remain enabled; the warning records unmeasured
  coverage, not a failed test. Script contracts uses the same applicability decision.
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
  Browser lanes retain a20-minute preparation/test phase. Job ceilings include
  separate finalization reserves; see [phase budgets](../frontend/testing.md#ci-evidence-and-admission).
  These limits are emergency headroom, not a runtime target or performance proof. Measure cold setup and runner-minutes as well as test time.
  [Local reproduction and isolation](../frontend/testing.md#complete-ci-e2e-locally).
  In `ci.yml`, browser jobs prefer the existing Ubuntu
  archive mirror over the Azure entry in the hosted runner's APT mirror list.
  A reachable but slow mirror does not trigger APT's failure fallback. This
  preference preserves release suites, fallback mirrors and package-signature
  verification; it does not change the test limits or assertions.
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
- **Script contracts** — job id `script-contracts`, runs `pnpm test:scripts`:
  every `scripts/lib/*.test.mjs` and `scripts/*.test.mjs`. These are unit and contract
  tests of the repository's own tooling: the `init:brand` initializer with the engine
  core, filesystem transaction and AST core it uses, product-admin placement, lint,
  Lighthouse, migrator, API E2E and deployment contracts, and the check that Console
  tests do not spell the default Console address. They read the current public working
  tree, including non-ignored untracked files, and use isolated copies for mutation
  fixtures. No Docker; the job's own `pnpm install --frozen-lockfile` is the only
  install. No path filter: a change anywhere in the repo can drift a contract. A test
  keeps this job, the root `test:scripts` script and the ruleset entry consistent. It
  does **not** cover the public/private-path ratchet — that is the separate
  "Observability contract (static)" job above.
  The migration history check compares the PR checkout with its first parent.
  On an unverified push it compares with the event's previous commit. A missing
  baseline on an existing branch or a changed or deleted shared migration fails
  the check. The first creation of main has an empty previous inventory. Additions
  are allowed. Verify SQL safety and collisions between new migrations separately.

**The observability-contract and script-contracts job contexts ("Observability
contract (static)", "Observability contract (live)", "Script contracts") are listed
in the tracked `.github/rulesets/main.json`'s `required_status_checks`** — as with
every ruleset entry in this file, that is the _declared intent_ checked into version
control, not live GitHub state. Applying it (making the check actually required to
merge) is the separate owner action described in
[Strict security setup after forking](#strict-security-setup-after-forking)
below — required-check contexts only become selectable in that flow after they have
run at least once on the repository. A newly added job context needs that same
one-time re-application after its first real run on the repository.

Browser E2E lanes use `ubuntu-24.04` to keep the operating-system major version
stable while `ubuntu-latest` migrates. Image updates within Ubuntu 24.04 still apply.
Changing this label requires verifying the Docker/browser lanes on the target image.

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
Current normal CI, including Web and security, must also pass.

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

- `strict` — protected `main`, PR-only changes, required status checks, immutable
  release tags, secret scanning, push protection and Dependabot alerts/updates.
  AMCore upstream uses squash-only. A downstream integrating AMCore releases uses
  `scripts/setup-repo-security.sh --fork-updates` and preserves source-update merge
  commits. Ordinary feature PRs may squash; GitHub does not choose per-PR methods for you.
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
`strict`, first check [feature availability and repository choice](updating-a-fork.md#choose-the-repository-and-protection-mode).
The full profile needs the corresponding GitHub features; flexible private products
use the manual route there. Then:

1. Install the GitHub CLI — `brew install gh` (or see https://cli.github.com).
2. Sign in with repository **admin** access — `gh auth login`
   (no manual token needed; the CLI handles it).
3. Verify the product CLI target with `gh repo set-default OWNER/PRODUCT` and `--view`.
4. For an initialized downstream, apply `bash ./scripts/setup-repo-security.sh --fork-updates`
   (also needs `jq`). AMCore upstream runs the command without the flag.

For public repositories this also enables native **secret scanning** and
**push protection**. For private repositories, check availability and configure
these separately if supported. The script enables the **dependency graph** + Dependabot alerts + **Dependabot security updates** (auto-PRs that fix
vulnerable dependencies — the only channel that patches a vuln whose fix is a
semver-major, since `dependabot.yml` ignores majors), and imports the **rulesets**
for `main` (PR-only,
**squash-only** upstream, or **squash + merge** with `--fork-updates`,
required status checks, block force-push, restrict deletions) and for **release tags** (`refs/tags/v*` — block tag update and
deletion, so published versions are immutable). It is the supported `strict`
setup. It preserves owner bypasses and check publishers. If an existing ruleset is
inactive, targets a different ref, or conflicts with a required publisher, setup
stops before changing settings. After setup it verifies the effective rules on main. The flag requires one canonical
`downstream-product` Mode field in PROJECT_CONTEXT.md. Unknown arguments and invalid
flag/context combinations fail before any GitHub call. The main profile is rendered
temporarily; tracked upstream rules stay unchanged. An unflagged strict product rerun refuses before mutation. Repeat the flag for reconciliation. Flexible and custom modes leave settings unchanged.

A Fork using `product/v*` release tags needs its own separately named tag ruleset,
with the same update/deletion protection for `refs/tags/product/v*`. Setup only
manages `v*`; verify product-prefix protection after reruns. An unavailable feature
can fail the API request; setup never silently removes protections to make it pass.

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

The Lint job runs a small API unit suite after installation, before downstream
build and test jobs start. This checks the installed Jest/SWC runtime without
building shared packages or starting Docker. Missing test-runner dependencies
therefore stop the dependent jobs early.

### CLI Tool Versions

Dependabot updates:

- `npm` dependencies;
- `uses:` action pins in the `github-actions` ecosystem.

The `fastify-stack` group also updates Nest common/core, testing and both HTTP
adapters together. These packages share framework contracts and must be reviewed
as one update. The configuration excludes `nestjs-cls` 7.0.2: closing one Nest
application clears the shared CLS hooks host and breaks another application in
the same process. A later version needs the existing multi-application API E2E
checks before admission.

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
PRs when its dependency graph supports the lockfile. GitHub currently
[does not detect dependencies in pnpm 12's two-document lockfile for security alerts/updates](https://github.blog/changelog/2026-10-20-dependabot-now-supports-npm-12-pnpm-11-and-12-and-bun-1-4/).
Dependabot also does not surface **semver-major** npm updates (ignored in
`dependabot.yml`), Docker base-image **digest drift**, or newer **curl-pinned CLI
tool** releases. It also does not bump the root `packageManager` pnpm pin or the
Node.js major selectors; the report has a **Toolchain** section for both (pnpm
versus the registry; Node majors versus the LTS, Current and next-LTS schedule).
Move the pnpm pin in one PR: root manifest, both Dockerfiles, the stand installer and
the official migration bootstrap image together (`scripts/lib/toolchain-pins.test.mjs` checks they agree).
The `dependency-freshness.yml` workflow closes that visibility
gap: on a weekly schedule (and on-demand via `workflow_dispatch`) it runs
`scripts/dependency-freshness.mjs` and **upserts a single tracking issue** (label
`dependency-freshness`, edited in place) listing all four categories (semver-major npm updates, Docker digest
drift, curl-pinned tool releases and the toolchain). It opens no PRs and is
a report only — triage each item and bump deliberately. Review semver-major
updates manually and read their upstream migration notes. Use a separate PR
when an update needs an independent migration or rollback. Explicitly reviewed
compatible updates may share a PR when each update has identified risks and
checks, and the combined rollback remains coherent. Preserve all required CI
coverage and installation policies. Record intentional deferrals in the
product's own backlog or issue tracker. Dependabot's major-version ignore and
automatic update groups remain unchanged.

The freshness report also reads open Dependabot and code-scanning alerts. For npm
alerts it shows installed immediate parents and the dependency ranges declared by
their latest published releases. Missing API/registry/graph evidence is explicitly
unknown, never a clean result. A listed fix is not proof of a compatible upgrade;
review the parent ranges and run the affected consumer checks. Image findings
require a rebuilt-image scan even when the upstream digest has not changed.
Recheck on advisory changes, supported parent/distro/toolchain releases and before
release. Existing holds remain; the report adds no overrides or automatic migrations.
The workflow requests `security-events: read` for code scanning. Dependabot reads
use the optional `DEPENDABOT_READ_TOKEN` Actions secret. Create a fine-grained PAT
restricted to this repository with **Dependabot alerts: Read-only**, then save it
under **Settings → Secrets and variables → Actions → New repository secret**.
The token is used only for the Dependabot read; issue writes retain `github.token`.
Set an expiry and renew the secret before it expires. Never paste the token into
an issue or workflow file. Without a working secret, the report keeps an explicit
gap instead of reporting zero alerts. No additional token is needed for code scanning.
After setup or renewal, run **Actions → Dependency freshness → Run workflow** on
`main`. Verify the updated issue's generation time and populated Dependabot rows;
a green workflow alone does not prove access. To revoke access, delete the secret
and revoke the PAT; the next report shows the gap again.

### Weekly lockfile refresh

Next.js is excluded from Dependabot updates while its exact-version route-cache
patch remains. The freshness report compares the patched version with npm's
`latest` tag separately, including patch/minor releases. Follow the
[patch update/removal checks](../frontend/next-route-cache-patch.md) before updating.

`lockfile-refresh.yml` runs on Tuesday at 07:00 UTC, or manually through
**Actions → Lockfile refresh → Run workflow**, selecting `main`. It refreshes direct
and transitive versions within existing manifest ranges and opens or updates one
PR from `chore/lockfile-refresh`. Only `pnpm-lock.yaml` enters the PR. Exact pins,
the root release-age policy and the `nestjs-cls`/`jest-mock-extended` holds remain.
Next.js also stays at its current resolution because it has a version-specific
patch. The entire `@bull-board/*` group is excluded: its Fastify adapter is pinned,
and its UI assets require hash and disclosure checks. Review Bull Board upgrades
through the separate Dependabot group. Keep these exclusions aligned with the
holds, patch lifecycle and reviewed board boundary.

A repository administrator must enable **Settings → Actions → General → Workflow
permissions → Allow GitHub Actions to create and approve pull requests**. Keep the
default token read-only; this job requests `contents: write` and `pull-requests: write`.
No extra secret is required. If the bot PR shows **Approve workflows to run**, approve
that CI run. Merge only after reviewing the diff and every required check on its
current head. A green refresh job alone does not prove compatibility.

No diff means no PR. For a red update or CI run, inspect the failure and fix it
manually; keep age restrictions and required checks intact. The ready-made
`peter-evans/create-pull-request` action manages the bot branch and PR. Keep manual
fixes in separate PRs to `main`, then rerun the refresh. This updates compatible
resolutions, including non-security updates; packages without a compatible fix
remain for manual review. It never merges automatically.

The root workspace explicitly sets `minimumReleaseAge: 1440` and
`minimumReleaseAgeStrict: true`. It also sets
`minimumReleaseAgeIgnoreMissingTime: false`: a registry entry without a publication
time fails with `ERR_PNPM_MISSING_TIME`. Fix the registry metadata or mirror;
waiting alone cannot establish an unknown publication time. The migration workspace
package shares this root policy and lock. Strict mode prevents fresh resolution from
persisting age exceptions. pnpm 12 re-checks every lockfile entry during `pnpm install --frozen-lockfile`. A lockfile that holds a version
published less than 24 hours ago therefore fails the install step with
`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`, even though the lockfile matches the
manifests. This happens when Dependabot or a contributor adds a very fresh package.
Wait until every offending package is 24 hours old, then rerun the complete CI
workflow with **Re-run all jobs**. Do not rerun individual or only failed jobs. Do not set
`trustLockfile`, lower `minimumReleaseAge` or add an exclusion to make the job pass:
each one switches off the protection against freshly published malicious versions.

The root npm entry in `dependabot.yml` explicitly sets a three-day cooldown for
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
It repeats the whole workflow to keep API and web plans and shard evidence in
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
Rollback of the repeat removal restores the focused/background job, its fresh
prepare and artifact upload, the Test dependency and expected set, contract tests
and documentation together. It does not migrate dependencies or persistent data.
