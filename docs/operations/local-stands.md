# Local development, preview and browser tests

Use managed commands when a checkout's ordinary `.env` points to a remote database
or another checkout is running. They create their own Postgres/Redis resources,
ports and configuration. Native `pnpm dev` and ordinary `docker compose` retain
their manual environment semantics; these commands do not guard arbitrary shell
or database operations.

## Prerequisites and commands

Install the repository's frozen dependencies. Use its supported Node/pnpm versions
and Docker Compose **2.24.4 or newer** for Docker lanes. The ordinary reference
stack retains its separate version floor. Install Playwright Chromium with
`pnpm --filter web exec playwright install chromium`. Sandbox permissions remain
necessary for Docker, network installs, browser processes and local listening
ports. Keep long runs in a foreground terminal with visible output.

`pnpm test:stands` checks isolation and recovery. Narrow a risk with
`pnpm test:stands --test-name-pattern="startup"`; options reach the Node runner.

| Goal                                 | Command                                      | Data lifetime                                           |
| ------------------------------------ | -------------------------------------------- | ------------------------------------------------------- |
| Develop against local infrastructure | `pnpm stand up`                              | Persistent preview data                                 |
| Prepare accounts and prove login     | `pnpm stand preview`                         | Persistent; repeated preview verifies existing accounts |
| Browser mocks and server MSW         | `pnpm stand e2e --lane mocked`               | Per-run source/output, no Docker                        |
| Full product/browser stack           | `pnpm stand e2e --lane real-stack`           | Fresh disposable database                               |
| HTTPS Console host stack             | `pnpm stand e2e --lane console-real-stack`   | Fresh disposable host-mode database                     |
| Inspect selected preview             | `pnpm stand status`                          | Read-only                                               |
| List records and labelled resources  | `pnpm stand list`                            | Read-only, includes missing-source orphans              |
| Stop preview                         | `pnpm stand down`                            | Retains named volumes                                   |
| Delete preview data explicitly       | `pnpm stand down --purge`                    | Deletes only proved-owned resources                     |
| Recover interrupted run              | `pnpm stand recover --id <stand-id> --purge` | Requires stopped children and resource ownership        |

`--id <stand-id>` selects a recorded identity, never an arbitrary URL or Compose
project. Default preview ID is `preview` within this checkout; e2e uses a fresh ID.
E2E refuses preview-purpose IDs so tests cannot change acceptance data.
`list` is diagnostic: resources removed concurrently after enumeration are skipped;
Docker connection or permission failures are still reported. Listing grants no
ownership or cleanup permission.
Scoped tests use `pnpm stand e2e --lane real-stack -- credential-containment.spec.ts`.
Low-level Playwright configs require an active supervisor lease; overriding
baseURL/project/environment does not authorize an external target.

The web package's `test:e2e` and `test:e2e:real-stack` commands delegate to
these managed lanes.

<!-- AMCORE_CONSOLE_STAND_COMMANDS_START -->

`test:e2e:console-real-stack` delegates to the HTTPS host lane;
`pnpm test:console-session-e2e` remains its entry point.
<!-- AMCORE_CONSOLE_STAND_COMMANDS_END -->

### CI lane reproduction

`node scripts/e2e-ci.mjs --all` runs the complete Web E2E contract locally with
CI settings through the same entrypoint as each GitHub lane. Local execution is
sequential; GitHub lanes have independent runners and fresh stands. See
[frontend testing](../frontend/testing.md#complete-ci-e2e-locally) for group
selection and inventory proof. These commands never reuse owner preview data.

### API Testcontainers

Backend Jest E2E uses `pnpm --filter api test:e2e`; scope it with
`--runTestsByPath test/<name>.e2e-spec.ts`. This is a separate lane from managed
browser stands. Its shared helper starts fresh Postgres/Redis Testcontainers,
sets their application/migration URLs and supplies a suite-local random JWT
secret before application import. No local `.env` preparation is required.
Secondary apps in the suite share that test secret. The shared setup helper
attempts cleanup of its created application and containers if bootstrap fails.
Tests using a custom setup remain responsible for its teardown.

### Managed stand admission

A managed invocation performs full admission before work, holds its lease and
pins the local Unix Docker endpoint and full DB/Redis container IDs. SQL fixtures
then authenticate the active run and use that exact Postgres container, without
re-rendering Compose or inspecting the whole stand for each query. The local psql
connection has explicit socket/user/database/port and cleared connection defaults.
It verifies the stand marker under a shared row lock in the same transaction as
the fixture work; missing or changed markers refuse before fixture SQL. Wrapper
bookkeeping preserves normal SELECT output and UPDATE command tags. Caller
transaction control and reconnects are unsupported. Redis likewise uses its exact
admitted container and explicit local transport. No target fallback or automatic
adoption occurs; recreation requires a new admission. Preview SQL uses the same
invocation-scoped lease/target capability. Bootstrap is a separate bounded step.

## What an agent gives the reviewer

Manual preview always uses `demo.user@preview.amcore.test` (USER) and
`demo.super-admin@preview.amcore.test` (SUPER_ADMIN when enabled), with the public
demo password `Demo!AMCore2026`. Recreating the stand preserves these credentials.
Preview login checks use the checkout's base-locale catalogue for the login form
and accept the account's saved supported locale on the product home page.
Tests that need unique users or password changes create separate test accounts;
technical DB/JWT secrets remain random. Production never seeds these accounts.

After `preview`, provide the printed localized URL, login/password for each role,
source hash and the concrete scenario to inspect. Accounts are registered through
the real API, roles are assigned only to those accounts, and browser login/access
is verified. Keep the stand running until acceptance or explicitly scoped cleanup.
`--profile user` prepares only USER; `--profile organization` additionally creates
an organization owned by USER with its organization ADMIN membership.
<!-- AMCORE_CONSOLE_STAND_PROFILE_START -->

The default also prepares SUPER_ADMIN when the Console feature is enabled.
<!-- AMCORE_CONSOLE_STAND_PROFILE_END -->

Do not put generated technical secrets, tokens or manifests in commits or shared
reports; the deliberately public demo credentials above are a separate contract.

Runtime records and source snapshots live under ignored `.amcore/stands/` with
private permissions. Source admission uses tracked build inputs plus nonignored
untracked source, excluding `.env*` except `.env.example`, secrets, other worktrees,
dependencies and generated runtime output. Source symlinks are refused; replace a
required public build input with an ordinary file rather than dereferencing
private/foreign files. Refresh rebuilds from
current source while retaining preview data. Unexpected account/role state fails
instead of silently resetting the reviewer's scenario.

## Target and cleanup safety

Managed Docker commands use a verified local Unix engine, explicit project/files/
profiles and clean child environment. The final generated override replaces
service environment/ports; host `.env` and inherited remote URLs are not inputs.
Postgres has no published port; SQL runs inside the inspected owned container.
Published web/API/Redis/TLS ports bind only to 127.0.0.1. Allocation is bounded;
actual socket binding decides availability. Never kill a foreign port owner.

Full invocation admission requires rendered config, live resource/environment/
network proof and the database's stand UUID marker. Initial metadata bootstrap runs only
after physical ownership proof. Application migration/seed/fixture/test work does
not proceed without the matching marker. Production migration remains seed-free;
test role seeding is a managed-stand operation.

These commands protect cooperative agents against accidental ambient-environment
or foreign-stand targeting. Agents must use the managed entry points for task
stands and fixtures. They do not sandbox arbitrary shell SQL, hostile fixture code
or an administrator controlling Docker. External runtime/network changes can
invalidate browser/API assumptions; per-query SQL proof is not continuous
attestation of every request. Resource disposal still performs fresh checks.

Resource disposal has a separate proof: local engine, recorded attempt, exact
IDs/labels/membership and approved mounts. It does not query Postgres or require
a marker, so failed startup and a broken database remain removable. Unproved
resources are preserved with recovery metadata. No prune, default-project cleanup
or automatic adoption of legacy resources is supported.

A lease covers startup, admission, tests and cleanup. Competing mutation commands
refuse. SIGINT/SIGTERM stops and awaits proved-owned process groups, including
descendants after their direct parent exits, before removing resources. Console
wrappers stop interrupted preparation groups with proved TERM/KILL escalation,
without waiting for inherited streams to close. After startup they forward
cancellation only to their managed runner and await its graceful cleanup;
they retain their own lease and child journal when verification fails.
The wrapper record also names its runner's recovery manifest; wrapper recovery
or closeout refuses an unfinished runner, including one in an external fixture.
Active groups retire only after a complete process census proves their absence;
a bounded count/digest audit records those retirements. Signalling requires a live
member's recorded PID and birth identity. Recovery refuses surviving recorded
members and ambiguous group identities. A foreign leader with the same numeric
ID is distinguishable only with a different recorded leader birth; it is never
adopted or signalled. New leases also record the supervisor birth. Legacy leases
with a live numeric occupant but no supervisor birth still refuse recovery.
Successful recovery archives the original lease/journal before replacing it;
failed proof preserves resources and makes cleanup incomplete. Do not remove a
lease merely because it is old.

On Linux, supplemental cwd discovery covers readable same-user processes;
ptrace-denied unrelated processes are skipped. Recorded child/group checks and
stand-path command checks still block disposal. This does not contain a deliberately
unrecorded process that hides both its cwd and command identity.

If the original worktree is missing, preserve/restore its private record under a
surviving checkout and use
`down --id <stand-id> --orphan --purge`; this path refuses live worktrees and
unfinished test leases, and proves physical resources before deleting them.
Cleanup failure retains the record; status and diagnostics distinguish failure
from successful disposal.

## Origins, local HTTPS and transport

Each Docker stand has unique `.localhost` hostnames: cookies do not isolate by
port. Product HTTP preview is the default.

Managed HTTP stands set `WEB_INVITATION_LOCAL_HTTP_ORIGIN` to their exact admitted
product origin for invitation continuation cookies. HTTPS stands leave it empty
and use the secure prefixed cookie. This local exception is independent of
`NODE_ENV`; an arbitrary HTTP Host or forwarded protocol cannot enable it.

<!-- AMCORE_CONSOLE_STAND_ORIGIN_START -->

Console host tests build a sanitized host-mode copy without changing the source
checkout. Console host mode accepts an
optional `ADMIN_CONSOLE_ORIGIN`: canonical HTTPS origin matching
`ADMIN_CONSOLE_HOSTNAME`, including an optional public port. Empty retains
`https://<hostname>`. Host routing still validates the hostname; CSRF accepts only
the exact configured origin. Do not weaken either guard for local testing.
<!-- AMCORE_CONSOLE_STAND_ORIGIN_END -->

Automated Chromium uses a loopback HTTP/CONNECT relay plus explicit
`--proxy-bypass-list=<-loopback>` to remove Chromium's implicit localhost bypass.
Request contexts configure/inherit their proxy separately. Only exact owned
authorities are admitted; no direct retry, global DNS patch or TLS MITM.
Raw Node probes use scoped lookup/SNI and per-request CA trust. Encrypted Host/path
validation belongs to the application, not the CONNECT tunnel.

The reviewer's ordinary browser does not use the test relay. Use a browser that
resolves `.localhost` to loopback; resolver failure does not justify editing
system DNS automatically. Host-mode fixtures use Caddy's local CA. Tests ignore
that fixture certificate only in their own contexts; installing/trusting a CA in
the reviewer's OS/browser is an explicit one-time owner choice.

## Mocked lane

Mocked/server-mocked projects share one owned Next dev server in a fresh sanitized
source copy. They use a selected loopback port, `reuseExistingServer=false`,
separate `.next` and report paths, frozen dependencies and a shared package build.
No DB/Redis/API is provisioned. MSW server interceptors use the synthetic
`http://api.mocked.invalid` root; missing mocks fail rather than reach an owner's
backend. Next testProxy's process-owned callback channel is separate from browser
proxy admission. Ordinary manual dev output remains independent.

The supervisor uses an allocated 0700 directory under the platform's `/tmp`,
with a short socket path recorded in the admitted run manifest. Child TMPDIR
does not change that location. Normal completion removes it; recovery/closeout
removes a stale socket only after process absence and socket ownership checks.
For the explicit Linux startup proof, run
`pnpm test:stands --linux-startup-proof --test-name-pattern='Linux managed'`.
This requires an already-cached `node:24-slim` Docker image and provisions a
separate Linux fixture container; ordinary safety runs skip it.

## Compose files

Keep `docker-compose.yml` as the root reference deployment entry point. Optional
prod/web/Console/dev overlays live in `docker/compose/`; specialized fixtures live
in `docker/testing/`. With overlays, put the root file first and explicitly use
`--project-directory <repo-root>`. The Redis-only dev file is standalone:

```sh
docker compose --project-directory . -f docker/compose/dev.yml up -d
```

Production/BYO/backup/observability instructions remain in their existing guides;
managed local commands do not replace those deployment contracts.

## Image build cache and network use

The `apps/api` and `apps/web` Dockerfiles keep the pnpm store (and, for the api
`deploy` step, pnpm's registry-metadata cache) in BuildKit cache mounts
(`id=pnpm-store`, `id=pnpm-metadata`), not in image layers. The mounts are shared by
every build on the machine, so all worktrees and stands reuse one set of downloaded
packages. A lockfile, manifest or `apps/api/prisma` change that invalidates the
install layer re-links packages from disk instead of downloading them again; a
source-only change costs no package traffic. This matters on metered connections:
a cold api+web build downloads a few hundred MB once, later builds download close
to nothing. Integrity checking is unchanged — `--frozen-lockfile` still verifies
every package against the lockfile hashes.

pnpm 11 reads these settings from `pnpm_config_*` variables; `npm_config_*` and
`PNPM_STORE_DIR` are ignored, which silently disables the cache mount. Check
`Content-addressable store is at: /pnpm/store/v11` in the build log if a build
downloads everything again.

`docker builder prune` (and `docker system prune -a`) removes these cache mounts and
the next build downloads packages again. Prefer a size cap such as
`docker builder prune --keep-storage <size>` over a full prune, and never prune base
images (`postgres`, `redis`, `node`, `testcontainers/ryuk`) that Testcontainers and
the stands expect to find locally.

## Closeout before removing a checkout

Run `pnpm stand closeout` in the task checkout before deleting its worktree. It
purges every proved-owned local stand, verifies that labelled containers, networks
and volumes are gone, and checks recorded process groups as well as source paths
for survivors; a short or changed process title does not waive group checks.
Kernel cwd inspection also blocks removal for an unobserved, reparented child
under the stand source: `/proc` on Linux and `lsof` on macOS. Inventory failure is
an incomplete check, never proof of absence. Such a child is recorded for manual
inspection, not automatically signalled from its cwd alone.
The common mocked CI runner allows up to ten seconds for natural child exit
before closeout; a survivor still fails the lane and preserves recovery records.
Also verify any external
fixture checkout recorded by the task's specialized proofs. Never delete the
worktree or its recovery records after a failure: closeout is incomplete until
resource/process removal is proved. Retaining a stand requires an explicit owner
decision recorded with its identity, reason and responsible person; retain the
needed source/recovery location too. Preview remains available during acceptance,
then the default closeout removes it.
