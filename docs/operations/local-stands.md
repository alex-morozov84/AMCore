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

| Goal                                 | Command                                      | Data lifetime                                           |
| ------------------------------------ | -------------------------------------------- | ------------------------------------------------------- |
| Develop against local infrastructure | `pnpm stand up`                              | Persistent preview data                                 |
| Prepare accounts and prove login     | `pnpm stand preview`                         | Persistent; repeated preview verifies existing accounts |
| Browser mocks and server MSW         | `pnpm stand e2e --lane mocked`               | Per-run source/output, no Docker                        |
| Full product/browser stack           | `pnpm stand e2e --lane real-stack`           | Fresh disposable database                               |
| HTTPS Console host stack             | `pnpm stand e2e --lane console-real-stack`   | Fresh disposable host-mode database                     |
| Inspect selected preview             | `pnpm stand status`                          | Read-only                                               |
| List local records                   | `pnpm stand list`                            | Read-only                                               |
| Stop preview                         | `pnpm stand down`                            | Retains named volumes                                   |
| Delete preview data explicitly       | `pnpm stand down --purge`                    | Deletes only proved-owned resources                     |
| Recover interrupted run              | `pnpm stand recover --id <stand-id> --purge` | Requires stopped children and resource ownership        |

`--id <stand-id>` selects a recorded identity, never an arbitrary URL or Compose
project. Default preview ID is `preview` within this checkout; e2e uses a fresh ID.
E2E refuses preview-purpose IDs so tests cannot change acceptance data.
Scoped tests use `pnpm stand e2e --lane real-stack -- credential-containment.spec.ts`.
Low-level Playwright configs require an active supervisor lease; overriding
baseURL/project/environment does not authorize an external target.

The web package's `test:e2e` and `test:e2e:real-stack` commands delegate to
these managed lanes.

<!-- AMCORE_CONSOLE_STAND_COMMANDS_START -->

`test:e2e:console-real-stack` delegates to the HTTPS host lane;
`pnpm test:console-session-e2e` remains its entry point.
<!-- AMCORE_CONSOLE_STAND_COMMANDS_END -->

## What an agent gives the reviewer

After `preview`, provide the printed localized URL, login/password for each role,
source hash and the concrete scenario to inspect. Accounts are registered through
the real API, roles are assigned only to those accounts, and browser login/access
is verified. Keep the stand running until acceptance or explicitly scoped cleanup.
`--profile user` prepares only USER; `--profile organization` additionally creates
an organization owned by USER with its organization ADMIN membership. The default
also prepares SUPER_ADMIN when the Console feature is enabled.
Do not put passwords, tokens or generated manifests in commits or shared reports.

Runtime records and source snapshots live under ignored `.amcore/stands/` with
private permissions. Source admission uses tracked build inputs plus nonignored
untracked source, excluding `.env*` except `.env.example`, secrets, other worktrees,
dependencies and generated runtime output. Source symlinks are refused; replace a required public build input with an ordinary
file rather than dereferencing private/foreign files. Refresh rebuilds from
current source while retaining preview data. Unexpected account/role state fails
instead of silently resetting the reviewer's scenario.

## Target and cleanup safety

Managed Docker commands use a verified local Unix engine, explicit project/files/
profiles and clean child environment. The final generated override replaces
service environment/ports; host `.env` and inherited remote URLs are not inputs.
Postgres has no published port; SQL runs inside the inspected owned container.
Published web/API/Redis/TLS ports bind only to 127.0.0.1. Allocation is bounded;
actual socket binding decides availability. Never kill a foreign port owner.

Data-use admission requires rendered config, live resource/environment/network
proof and the database's stand UUID marker. Initial metadata bootstrap runs only
after physical ownership proof. Application migration/seed/fixture/test work does
not proceed without the matching marker. Production migration remains seed-free;
test role seeding is a managed-stand operation.

Resource disposal has a separate proof: local engine, recorded attempt, exact
IDs/labels/membership and approved mounts. It does not query Postgres or require
a marker, so failed startup and a broken database remain removable. Unproved
resources are preserved with recovery metadata. No prune, default-project cleanup
or automatic adoption of legacy resources is supported.

A lease covers startup, admission, tests and cleanup. Competing mutation commands
refuse. SIGINT/SIGTERM stops and awaits owned children before removing resources;
forced termination leaves records for explicit recovery. Recovery refuses a live
or reused PID or possible surviving child; inspect the recorded processes before
retrying. Do not remove a lease merely because it is old. If the original worktree
is missing, preserve/restore its private record under a surviving checkout and use
`down --id <stand-id> --orphan --purge`; this path refuses live worktrees and
unfinished test leases, and proves physical resources before deleting them. Cleanup failure retains
the record; status and diagnostics distinguish failure from successful disposal.

## Origins, local HTTPS and transport

Each Docker stand has unique `.localhost` hostnames: cookies do not isolate by
port. Product HTTP preview is the default.

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
