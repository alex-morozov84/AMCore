# Production Deploy Profile

The concrete contract for taking a merged commit to production: what gets
built, what gets promoted, which environment gates which step, and what a
GitHub Environments setup for this needs. [Deployment & migrations](deployment.md)
already covers _how the app runs_ (process roles, migrations, TLS, SSE); this
page covers _how a build moves from `main` to a live production instance_
without ever being rebuilt along the way.

This is a reference contract for downstream adoption. The bundled workflow builds
and resolves images, but its deployment steps only print instructions. It does
not deploy staging or production, and a successful run does not prove either
application ran. Configure and verify the target actions before relying on promotion.

## Open browser tabs

The production web build includes automatic document replacement after a new
build is detected. Keep the build identity with the image digest through
promotion and rollback; do not assign a new identity at container startup.
See [open tabs after a deployment](deployment.md#open-tabs-after-a-web-deployment)
for draft loss, transient Action failures, endpoint freshness and browser limits.

The [registry rollout procedure](deployment.md#production-rollout-via-registry-image-pull-path)
covers digest checks, first startup, readiness waits and artifact inspection.
Compose accepts tag references too; the operator must check immutable digests.

## Who this is for

Use this profile when publishing images to a registry and promoting the same
artifact between environments. The [Compose rollout](deployment.md#production-rollout-via-registry-image-pull-path)
also supports a human-operated host. Choose where to run the images with the
[platform matrix](deployment-platforms.md); this page defines promotion.

## The contract

The table describes the target pipeline to configure. The template has different
triggers and placeholder deployment actions, described below.

| Trigger                                 | Environment  | What happens                                                                                                                                                                                                                |
| --------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR opened                               | CI checks    | Lint/type/test/build only. No image is published.                                                                                                                                                                           |
| Merge to `main`                         | `staging`    | Build the `api`, `api` migrator, and `web` images **once**; tag each `sha-<commit>`; push to the registry; capture the resulting **digest**. Deploy `staging` by pulling that digest.                                       |
| Push a `vX.Y.Z` tag / publish a Release | `production` | **Do not rebuild.** Re-resolve and deploy the exact digest that `staging` already validated for that commit. A required reviewer must approve before the environment-gated job can read `production`'s environment secrets. |

Production must receive the exact immutable digests verified on staging.
The template uses `sha-<first-seven-commit-characters>` lookup tags.
A lookup tag can move; it does not replace the full source commit or an image digest. Keep the three
staging-validated digests as release evidence and compare them before production.
Resolving a tag for the same commit does not prove staging ran those bytes.

Before the one-shot migration job, run the promoted migrator digest's
[endpoint preflight](migrator-image.md#process-and-database-lifecycle) with that
environment's migration credential. Require success for the exact endpoint.
Keep the image's Tini entrypoint through job overrides and digest promotion.
A scan report or a passing build does not establish database lifecycle support.

### Why a required reviewer, not just a tag push

When the repository has configured its tag ruleset, a `v*` tag is immutable
(no update/delete — see
[CI & repo security](ci-security.md)) but tag _creation_ alone is not a human
approval gate. GitHub Environments add that: a `production` environment
restricted to the `v*` tag pattern, with required reviewers, means the
deploy job's own secrets are **not even readable** by the workflow run until
a reviewer approves — a materially stronger guarantee than "a secret with a
different name."

## Setting up the GitHub Environments

Repository → Settings → Environments → New environment. Do this once per
repository that adopts the live path (not required for the VPS/Compose-only
path, where a human running `docker compose up` already is the approval
step).

**`staging`:**

- Deployment branches and tags → _Selected branches and tags_ → add a
  **Branch** rule: `main`.
- No required reviewers in this reference setup. Confirm the repository's
  actual branch protections and required checks; tracked files do not enforce them.
- Environment secrets: staging's own database/Redis/storage credentials,
  registry pull credentials if the runner isn't already authenticated.

**`production`:**

- Deployment branches and tags → _Selected branches and tags_ → add a
  **Tag** rule: `v*`. This is the literal mechanism that makes "production
  only deploys from a release tag" true — no custom workflow condition
  needed. (GitHub matches tag rules against `GITHUB_REF`; wildcards do not
  cross a `/`, so `v*` will not accidentally match `v1/rc`-style refs.)
- Required reviewers: the repository's maintainer(s). Optionally enable
  "prevent self-review" so the person who pushed the tag isn't the one who
  approves the deploy.
- Optional: a wait timer before the production job. It delays this job;
  it does not measure elapsed time since staging became healthy.
- Environment secrets: see the checklist below. These are withheld from the environment-gated
  job until its configured protection rules pass. Keep equivalent credentials
  out of repository/organization secrets and check administrator bypass settings.

Availability depends on repository visibility and plan. GitHub documents required
reviewers and wait timers on Free/Pro/Team only for public repositories.
Private environment support does not imply private approval-gate support.
Check the [current feature availability](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
and the repository's actual settings. If the required gate is unavailable,
stop this adoption path and choose an explicitly reviewed deployment approval mechanism.

## Secrets and variables checklist

Map each credential to the narrowest scope that can hold it. Prefer **OIDC**
over a long-lived static credential everywhere the deploy target supports
federated identity (major clouds do) — it removes a standing secret from the
repository entirely rather than just scoping one.

| Credential                                                                                  | Scope                                                                                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry push credentials (build job)                                                       | `staging` environment (or a narrowly-scoped repo secret if the build job itself isn't environment-gated) | Use the short-lived workflow `GITHUB_TOKEN` with `packages: write` for GHCR. Use OIDC separately where the target supports federation; these are different authentication mechanisms.                                                                                                                                                                                                                                                                                                                                                                                               |
| Registry pull / SSH deploy key (deploy job → target host)                                   | Environment secret, scoped to the environment that deploys                                               | Never a repo secret — a repo secret is available to any workflow run that reaches it, including privileged triggers (`push`, `workflow_dispatch`, `pull_request_target`, `workflow_run`) that may check out and execute a fork PR's code. (An ordinary `pull_request`-triggered run from a fork does **not** get repo secrets, only a read-only `GITHUB_TOKEN` — the risk is broad accessibility to a run that _does_ have secrets and _does_ execute less-trusted code, not the plain fork-PR case.) An environment secret adds the required-reviewer gate on top of that scoping. |
| Production database migrator-role URL                                                       | `production` environment secret only                                                                     | This is the schema-owning role from [Database role separation](database-role-separation.md), not the app's runtime DML-only credential — never place it in `staging` or a repo secret.                                                                                                                                                                                                                                                                                                                                                                                              |
| JWT signing material, storage/S3 credentials, third-party API keys the app needs at runtime | Environment secret per environment (`staging` vs `production` get different values)                      | These are _application_ secrets injected into the running container, not CI secrets — don't conflate the two even when they're both "environment secrets" in GitHub's UI.                                                                                                                                                                                                                                                                                                                                                                                                           |
| Cloud provider credentials for the deploy step itself (if deploying to a managed platform)  | Environment secret, OIDC preferred                                                                       | See GitHub's own OpenID Connect guidance for the federated-identity setup per cloud provider.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Self-hosted runner warning

If any job in this pipeline runs on a **self-hosted runner** rather than a
GitHub-hosted one: environment secrets do not make a compromised self-hosted
runner safe. GitHub's own Actions security guidance is explicit that
self-hosted runners lack the isolation guarantees of hosted runners — a
runner that executes untrusted code (e.g. from a fork's PR, if it's ever
wired to run there) can read anything injected into its process regardless
of which GitHub-side scope the secret came from. Keep deploy jobs that need
real secrets off any runner that also executes less-trusted workflows, and
prefer GitHub-hosted runners for this pipeline unless there's a specific
reason not to.

## Deploy workflow template

[`.github/workflows/deploy-template.yml`](../../.github/workflows/deploy-template.yml)
implements image build and digest lookup, with deployment placeholders:

- Choosing `main` builds and publishes API, migrator and web images to GHCR.
  Its `staging` job prints digests and example instructions; it deploys nothing.
- Choosing a `v*` tag resolves already-published commit-tagged images without
  rebuilding. Its `production` job prints the resolved digests; it deploys nothing.
  Missing images fail lookup. Existing images alone do not prove staging validation.

**It is `workflow_dispatch`-only on purpose** — it never runs on `push` or
`pull_request`, so it needs no configured secret to keep this repository's
required CI green, and it never fires for AMCore upstream on its own.
Triggering it is a deliberate action, not something a fork inherits as live
automation.

- **The build job needs no secret you have to configure.** It authenticates
  to GHCR with the workflow's own `GITHUB_TOKEN` (`packages: write` is
  sufficient for the declared build permission). Confirm package access and
  registry availability before running it.
- **The final deploy step on each path is an illustrative placeholder.** It
  prints the digests to deploy and tells you where your real deploy command
  goes (the complete ordered Compose rollout or your platform's deploy API). Replace that step once you have a real
  target. The template demonstrates lookup; real deployment and digest equality checks
  remain adopter responsibilities. Preserve complete overlays and the preflight,
  worker-first readiness and failure stops from the linked rollout procedure.
  Do not execute the template's shortened printed Compose sketch as a runbook.
- **Create the `staging`/`production` GitHub Environments first.** Referencing
  an environment that doesn't exist yet makes GitHub silently create it with
  no protection rules at all — exactly the ungated behavior this whole
  contract exists to prevent. Follow "Setting up the GitHub Environments"
  above before running this workflow for the first time.
- **Going live:** once you have a real target, replace the `workflow_dispatch`
  trigger with real ones — `on: push: branches: [main]` for the build path,
  `on: push: tags: ['v*']` for the promote path — so the pipeline runs
  automatically instead of on manual dispatch.

**To exercise the whole contract end to end**, from the Actions tab →
**Deploy Template (Registry + Digest Promotion)** → **Run workflow**:

1. Run it choosing `main`. This builds and publishes images for `main`'s
   current commit. After implementing the target action, deploy those digests to
   staging and retain successful application checks and their exact identities.
2. Tag that same commit with an **annotated** tag (matching this repo's own
   release convention — see [Deployment &
   migrations](deployment.md#branch-release--environments-model)) and push
   it: `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`. A lightweight
   tag (plain `git tag vX.Y.Z`) works for the workflow's own ref-matching, but
   don't use one here — it isn't what this repo's release process creates.
3. Run the workflow again, choosing that tag. It resolves the digests step 1
   already published. Compare all three with the retained staging evidence.
   After approval, the implemented production action must deploy those exact
   digests and verify the target. The unmodified template only prints them.
   Choosing a tag whose
   commit was never published via step 1 fails loudly instead of building one
   for you; that failure is the point, not a bug.

### Deployment-capable MFA artifacts

The template passes the full source commit through `BUILD_SOURCE_COMMIT` to
API, migrator and web builds. The API and web images write MFA compatibility
artifacts. A build without that input records `sourceCommit: null` and fails
MFA deployment preflight. Collect and verify artifacts from every actual
instance before MFA deployment.
Do not infer a deployable MFA fleet from successful image publication. Follow
[MFA deployment](../auth/mfa-deployment.md); image rollout alone does not activate MFA.

## See also

- [Migration image](migrator-image.md) — the separate frozen CLI graph, version
  guard and upkeep; promote the resulting migrator digest with its matching API.

- [Deployment & migrations](deployment.md) — the branch/release/environment
  model this contract extends, the one-shot migration contract, process
  roles, TLS/reverse-proxy setup, and the `docker/compose/prod.yml`
  image-pull rollout (immutable digest pinning, restart policies, log
  rotation, and honest zero/low-downtime guidance).
- [Database role separation](database-role-separation.md) — the
  migrator/runtime role split behind the migrator-role secret this page's
  checklist places in the `production` environment only.
- [Secret rotation](secret-rotation.md) — rotating `JWT_SECRET`, database
  credentials, and third-party API keys once they're already in place; this
  page covers where they're placed, not how to change their value later.
- [Deployment platforms](deployment-platforms.md) — the decision matrix for
  managed hosting targets; this page's build-once/promote-by-digest contract
  is demonstrated against the registry + GitHub Environments path, not tied
  to one platform.
- [CI & repo security](ci-security.md) — what a fork inherits automatically
  versus what must be configured separately (including GitHub Environments),
  and the immutable `v*` tag ruleset this contract relies on.
- [Backup & restore](backup-restore.md) — what to do if a bad deploy needs a
  data rollback, not just a container rollback.
