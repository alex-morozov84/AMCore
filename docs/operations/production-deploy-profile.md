# Production Deploy Profile

The concrete contract for taking a merged commit to production: what gets
built, what gets promoted, which environment gates which step, and what a
GitHub Environments setup for this needs. [Deployment & migrations](deployment.md)
already covers _how the app runs_ (process roles, migrations, TLS, SSE); this
page covers _how a build moves from `main` to a live production instance_
without ever being rebuilt along the way.

**What this is:** a reference contract plus a setup checklist an adopter can
apply to their own repository.

**What this isn't:** a live, running deploy pipeline for AMCore upstream
itself. AMCore is a forkable starter with no single real production target —
this contract and its companion workflow template ([Deploy workflow
template](#deploy-workflow-template) below) exist so a downstream product can
adopt a professional path deliberately, not because upstream AMCore publishes
images or deploys anywhere today. If that changes, it will be called out
explicitly in `CHANGELOG.md` and this doc.

## Who this is for

Two deploy paths are equally first-class in AMCore, and neither is "the
beginner one":

- **VPS + Docker Compose** — see [Deployment & migrations](deployment.md) for
  the reference stack itself; this page's contract still applies (build once,
  tag with a commit SHA, promote the same digest) even when you never touch a
  registry's web UI.
- **Registry + immutable digest + GitHub Environments** — the path this page
  is mainly about: a CI-built, digest-addressed image, promoted through a
  `staging` environment gated on `main` and a `production` environment gated
  on an approved release tag.

A platform decision matrix for managed hosts (Kubernetes, Cloud Run, Fly,
Render, Railway, Vercel-for-web-only) is tracked separately in this same
production-readiness track; it evaluates _where_ to run the promoted image,
not the promotion contract itself, which applies regardless of target.

## The contract

| Trigger                                 | Environment  | What happens                                                                                                                                                                                       |
| --------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR opened                               | CI checks    | Lint/type/test/build only. No image is published.                                                                                                                                                  |
| Merge to `main`                         | `staging`    | Build the `api`, `api` migrator, and `web` images **once**; tag each `sha-<commit>`; push to the registry; capture the resulting **digest**. Deploy `staging` by pulling that digest.              |
| Push a `vX.Y.Z` tag / publish a Release | `production` | **Do not rebuild.** Re-resolve and deploy the exact digest that `staging` already validated for that commit. A required reviewer must approve before the job can even read `production`'s secrets. |

The non-negotiable rule this whole page exists to enforce: **the artifact that
reaches production is byte-for-byte the artifact staging already ran**,
addressed by its immutable digest (`ghcr.io/<org>/<image>@sha256:...`), never
a tag that could have moved and never a fresh build from the tag. A tag is a
human-readable pointer; the digest is what actually gets deployed. This is
the same discipline Kamal, Docker's own publishing guidance, and GitHub's own
"build once, deploy many" pattern converge on independently — it isn't an
AMCore-specific invention.

### Why a required reviewer, not just a tag push

A `v*` tag is protected (immutable, no update/delete — see
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
- No required reviewers — merging to `main` already passed required CI
  checks and (in `strict` mode) is PR-only.
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
- Optional: a wait timer, if you want a mandatory soak period between a
  staging deploy and production eligibility even after approval.
- Environment secrets: see the checklist below. These are inaccessible to any
  job until a required reviewer approves — the job cannot even read them
  earlier to exfiltrate them via a log line.

Availability note: required reviewers and environment secrets on a
_required-approval_ environment need GitHub Pro/Team/Enterprise on **private**
repositories (public repositories get this on the Free plan, which is
AMCore upstream's own case). A downstream fork that goes private should
confirm its plan covers this before relying on the gate.

## Secrets and variables checklist

Map each credential to the narrowest scope that can hold it. Prefer **OIDC**
over a long-lived static credential everywhere the deploy target supports
federated identity (major clouds do) — it removes a standing secret from the
repository entirely rather than just scoping one.

| Credential                                                                                  | Scope                                                                                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry push credentials (build job)                                                       | `staging` environment (or a narrowly-scoped repo secret if the build job itself isn't environment-gated) | Prefer a registry that supports OIDC-based push (e.g. GHCR via `GITHUB_TOKEN` with `packages: write`) over a long-lived PAT.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Registry pull / SSH deploy key (deploy job → target host)                                   | Environment secret, scoped to the environment that deploys                                               | Never a repo secret — a repo secret is available to any workflow run that reaches it, including privileged triggers (`push`, `workflow_dispatch`, `pull_request_target`, `workflow_run`) that may check out and execute a fork PR's code. (An ordinary `pull_request`-triggered run from a fork does **not** get repo secrets, only a read-only `GITHUB_TOKEN` — the risk is broad accessibility to a run that _does_ have secrets and _does_ execute less-trusted code, not the plain fork-PR case.) An environment secret adds the required-reviewer gate on top of that scoping. |
| Production database migrator-role URL                                                       | `production` environment secret only                                                                     | This is the schema-owning role from the (separate) DB role-separation guide, not the app's runtime DML-only credential — never place it in `staging` or a repo secret.                                                                                                                                                                                                                                                                                                                                                                                                              |
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

The mechanical implementation of this contract (a workflow that actually
builds, tags, pushes, captures the digest, and gates staging/production
deploys behind the environments above) is a separate, explicitly
non-active-for-upstream template — tracked as the next increment in this same
production-readiness work. It will not require real secrets to exist for
CI to stay green on this repository, and it will not publish or deploy
anything for AMCore upstream unless the maintainer separately decides to
turn it on.

## What this page doesn't cover yet

Tracked as separate, focused pieces of the same production-readiness
initiative — each gets its own doc rather than growing this one indefinitely:

- The actual VPS/Compose production hardening (log rotation, restart
  policies, health-gated rollout, immutable digest pinning in
  `docker-compose.yml`) — extends
  [Deployment & migrations](deployment.md).
- An automated backup restore-drill procedure — extends
  [Backup & restore](backup-restore.md).
- Production database role separation (a migrator/owner role distinct from
  the app's runtime role).
- A secret-rotation runbook (JWT signing material, database credentials,
  third-party API keys).
- The platform decision matrix for managed hosting targets.

## See also

- [Deployment & migrations](deployment.md) — the branch/release/environment
  model this contract extends, the one-shot migration contract, process
  roles, and TLS/reverse-proxy setup.
- [CI & repo security](ci-security.md) — what a fork inherits automatically
  versus what must be configured separately (including GitHub Environments),
  and the immutable `v*` tag ruleset this contract relies on.
- [Backup & restore](backup-restore.md) — what to do if a bad deploy needs a
  data rollback, not just a container rollback.
