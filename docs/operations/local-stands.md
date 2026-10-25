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
Test files run sequentially by default because they share the host network:
Docker network changes can interrupt Chromium's transport checks. Deliberate
concurrent scenarios within a test retain their own process and stand orchestration.

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
| Delete preview data explicitly       | `pnpm stand down --purge`                    | Deletes only proved-owned resources, built images too   |
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

### Initial organization installation proof

Use a fresh closed-registration fixture for the first account and organization:

```sh
pnpm stand e2e --lane real-stack --fixture organization-setup -- organization-initial-setup.spec.ts
```

This fixture disables public signup and self-service organization creation.
It runs the compiled setup command in the owned API runtime image.
The existing password-recovery flow generates and consumes the actual rendered email link.
A test-only replacement for the mock transport sends fake-recipient mail to an internal collector container.
The collector has no published port or volume. It retains at most1MiB in memory for five minutes.
The admitted helper consumes each message once through the pinned owned container.
Tokens never enter test attachments, trace, screenshots, logs or command arguments.
This fixture uses only the list reporter with API-step printing disabled.
HTML/blob reports retain navigation URLs even without traces, so they are not enabled here.
The production email provider and environment contract contain no capture feature.
Each run owns its database, images and cleanup. It cannot reuse an owner preview.

The fixed-shop example uses `--fixture organization-shop` on a fresh Docker E2E
instead: buyer signup stays enabled and self-service organization creation is disabled.
It has no mail collector or initial-account mutation helper access.

<!-- AMCORE_CONSOLE_PROVISIONING_STAND_START -->

### Organization creation and first-administrator invitation

Use a separate closed-registration fixture for operator provisioning:

```sh
pnpm stand e2e --lane console-real-stack --fixture organization-provisioning -- organization-provisioning.spec.ts
```

This fresh fixture selects Resend with fake credentials. Its sanitized source copy
routes direct mail to the same internal collector; SDK fallback URLs also remain
internal. It does not contact Resend or prove external inbox delivery. The fixture
keeps the managed development environment; it does not bypass production startup
requirements or prove production TLS configuration.

The test prepares only its first operator account through the guarded setup helper.
It uses an actual recovery email before granting that disposable account platform
access. Organization creation then uses Console. The recipient receives the actual
rendered invitation and verification emails, registers through the invitation and
explicitly accepts. Registration and verification must leave membership empty.
The helper cannot bootstrap an organization or administer the recipient account.

The collector, ownership checks and secret-artifact restrictions above also apply
to this fixture. It cannot reuse a preview or send mail to ordinary addresses.

<!-- AMCORE_CONSOLE_PROVISIONING_STAND_END -->

<!-- AMCORE_CONSOLE_SUPPORT_MAIL_STAND_START -->

### Support-mail recipient completion

Use fresh, separate website/staff/Console fixtures:

```sh
pnpm stand e2e --lane product-admin-real-stack --fixture support-mail-path -- console-support-mail.spec.ts
pnpm stand e2e --lane product-admin-real-stack --fixture support-mail-host -- console-support-mail.spec.ts
```

Both fixtures use fake Resend credentials and redirect every supported provider
entry path inside the source snapshot to the internal collector. The direct
replacement preserves the final synchronous transport callback. These runs
prove rendered links and recipient completion, not external inbox delivery.
They retain only step-free list results, with trace/video/screenshots disabled.

For manual inspection use a separate mock preview:
`pnpm stand preview --id support-mail-review --profile support-mail`.
It prepares fake targets and labelled historical examples, preserves later owner
actions on refresh, and sends no real email. It has no collector. Do not use
preview examples as retention, elapsed-time or recipient-completion proof.

<!-- AMCORE_CONSOLE_SUPPORT_MAIL_STAND_END -->

<!-- AMCORE_CONSOLE_ESTABLISHMENT_STAND_START -->

Test the same lifecycle through the HTTPS Console with:

```sh
pnpm stand e2e --lane console-real-stack --fixture organization-setup -- console-organization-setup.spec.ts
```

For manual initial-setup acceptance, prepare a separate fresh preview:

```sh
pnpm stand preview --id initial-organization --profile organization-establishment
```

This preview keeps demo registration available and disables self-service organization creation.
It prepares the usual two demo accounts and marks only the recorded demo USER mailbox as confirmed.
This is demo data, not proof of production email delivery. The isolated test above supplies that proof.
In Console, open **Organizations → First organization**, enter `demo.user@preview.amcore.test`, and select **Continue**.
The next step explains that this demo account has already confirmed its email. Enter the organization details,
continue to confirmation, then select **Create organization**. The operator receives no organization membership automatically.
Refreshing this preview preserves the completed setup and does not restore removed access.
Use the ordinary default preview on a separate ID to inspect self-service creation.

<!-- AMCORE_CONSOLE_ESTABLISHMENT_STAND_END -->

For self-service creation acceptance, use
`pnpm stand preview --id organization-creation --profile organization-creation`.
This opens and cancels the new form without creating an organization for the reviewer.

The web package's `test:e2e` and `test:e2e:real-stack` commands delegate to
these managed lanes.

A stand starts the web service closed to search engines. To try the open state, set
`AMCORE_STAND_WEB_SITE_ORIGIN` (an `https` origin, for example `https://shop.example.test`; the stand
adds it to the trusted origins) and `AMCORE_STAND_WEB_SEO_INDEXING=enabled` in the shell that runs
`pnpm stand up`, then request the stand with `-H 'Host: shop.example.test'`. A running stand refuses a
changed environment, so run `pnpm stand down` before the next `up` with other values. See
[Search-engine indexing](../frontend/seo.md#try-the-open-state-locally).

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

### Migration image in Docker stands

The Docker stand's `migrate` service uses the separate
[migration image](migrator-image.md). Keep its Tini entrypoint and default CLI
command. The image adds its disconnect-check startup option only to the selected
migration URL. It preserves `E2E_DATABASE_URL` priority and does not change the
stand's API/worker URLs or database role defaults. Host-side API Testcontainers
continue to use their own Prisma CLI configuration; they do not use this image.

### API Testcontainers

Backend Jest + SWC E2E uses `pnpm --filter api test:e2e`; scope it with
`--runTestsByPath test/<name>.e2e-spec.ts`. This is a separate lane from managed
browser stands. Its shared helper starts fresh Postgres/Redis Testcontainers,
sets their application/migration URLs and supplies a suite-local random JWT
secret before application import. No local `.env` preparation is required.
Secondary apps in the suite share that test secret. The shared setup helper
attempts cleanup of its created application and containers if bootstrap fails.
Tests using a custom setup remain responsible for its teardown.

Prepare a fresh checkout with `pnpm install --frozen-lockfile`, then
`node scripts/api-e2e-ci.mjs --prepare`. Preparation generates Prisma and builds
shared; execution checks the preparation receipt before discovery or Docker.
`node scripts/api-e2e-ci.mjs --all` runs the standard inventory sequentially.
SWC transforms E2E TypeScript to ESM and preserves decorator metadata.
Run API `typecheck` separately. The preparation receipt hashes the shared SWC
config, so a compiler-setting change requires a new `--prepare`.

`--shard=i/n` uses Jest's built-in partition, with at most three shards.
Each suite gets one fresh in-band Node process and a 1 GiB V8 heap limit.
No pool replays or automatic suite retries are allowed. Missing assertion metadata,
skipping, signals, forced exits and incomplete reports fail the run.

The parent saves partial evidence under `.amcore/api-e2e-results`.
Natural process exit and absence of attempt-labelled containers are required.
Shared teardown attempts workers, app and containers even after a close rejection.
Cleanup has phase deadlines and a 60-second parent deadline. Forced termination
cannot turn a failed attempt green. Malformed reporter data cannot disable the
termination watchdog. Custom queue-graph teardown also retains close failures and
attempts its Redis stop. Only a complete ordinary assertion-failure report permits
the next suite; incomplete reports stop the lane. Emergency container removal checks both exact
run and attempt labels. It never removes Ryuk or another run's resources.
CI artifact admission binds the canonical plan to the current GitHub run and attempt.
For local artifact inspection, the aggregate command requires explicit `--local`
and rejects inherited GitHub run context. Local inspection still checks checkout
SHA and full evidence; it does not admit stale evidence in CI.
A new local full run needs a changed hypothesis or its designated delivery stage.

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

Managed stands apply migrations through the production migrator. Their separate
`seed` service runs the existing guarded catalogue seed from the API `build` target,
as user `node`, against the same admitted local database. Its image participates
in the stand's build-intent, identity and cleanup inventory. The service has no
published ports or source mounts. It is absent from production Compose.

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
The [custom administration example](../product-admin/adoption.md#connect-the-chosen-interface)
can prepare a copy-only adapter for the existing `organization` profile.
Run its `--preview` generator only after single-locale/no-Console initialization.
The adapter records provenance before writing and preserves later owner changes.
It does not introduce a global preview profile.

`--profile user` prepares only USER; `--profile organization` additionally creates
an organization owned by USER with its organization ADMIN membership.
`--profile organization-roles` instead seeds a large reproducible dataset for the role editor: three
organizations, 55 custom roles (presets, advanced and DENY rules, shared and duplicate rules, one role
too large to edit), 220 fake members without passwords, and 14 invitations. USER administers all
three and holds one custom role. A few Acme members show the member access view: a veto on one field, a
blocked delete, a holder of more roles than the per-role breakdown covers and a link to a role of another
organization. Rows are written only through marker-locked fixture SQL and are
skipped when already present; a repeat run verifies the recorded identity and never undoes edits.
The command prints one roles page address per organization.
`--profile member-api-keys` creates an organization with four sample members:
No integrations, Export manager (3 keys), Automation manager (25 keys) and Large
integration set (1001 keys). Sample keys have no usable secret. This fixture uses
managed marker-admitted SQL and never resets completed owner actions. Open the
printed Members address to inspect empty, expiry, pagination, revoke and limit.
<!-- AMCORE_CONSOLE_STAND_PROFILE_START -->

The default also prepares SUPER_ADMIN when the Console feature is enabled.
For notification delivery acceptance, create a fresh ID with
`pnpm stand preview --id notification-work --profile notification-work`.
This profile adds an internal fake Telegram provider and 17 repeatable delivery
cases. It sends no real messages. Five actual client HTTP429 witnesses establish
one safe retry case; its sixth call can receive fake acceptance. Claims initially
start paused. Other cases cover pending cancellation, a reserved/spent grant,
unknown effects, permanent failure, changed version/target, protected legacy
history, old/recent cleanup and truncated/expired history. Repeated preview keeps
the owner's changes and does not reseed removed deliveries. The fake provider
counter uses an owned volume; stop/purge follows the usual managed commands.
For AI run control acceptance, use `pnpm stand preview --id ai-run-control
--profile ai-run-control`. This profile pauses new AI claims and creates five text
runs through the owner API: queued, transient retryable, permanent failure,
recent cancellation and cancellation older than 30 days. It uses the mock model.
Repeated preview keeps the owner's changes.
For the Console Scheduled jobs screen, use `pnpm stand preview --id scheduled-jobs
--profile scheduled-jobs`. The running worker records its frequent jobs itself; the profile
adds a result history to the daily jobs, which otherwise show "No runs yet" until 02:00:
cleanup partly done and overdue, notification cleanup failed and overdue, invitation cleanup
with no recorded end. GeoIP is turned off in a stand. Repeated preview keeps the owner's changes.
<!-- AMCORE_CONSOLE_SUMMARY_GUIDE_START -->

For isolated Overview source-failure and chart-navigation checks, run
`pnpm stand e2e --lane real-stack --fixture console-summary -- admin-overview.spec.ts -g 'summary fixture'`.
This E2E-only fixture retains real authorization, stores a prepared failed delivery,
and provides controlled source responses through an internal proxy. Its local,
pinned Grafana has an offline dashboard with no metrics. The test proves navigation
and time selection, not monitoring history or real provider delivery. It uses a
fresh stand and cannot reuse an owner preview; managed cleanup owns all resources.
<!-- AMCORE_CONSOLE_SUMMARY_GUIDE_END -->

For the Console Integrations screen, use `pnpm stand preview --id integrations --profile integrations`.
The profile marks the demo `SUPER_ADMIN` address verified (a demo-only mailbox substitute), because
the test email goes only to the operator's own verified address. A stand uses the mock email
provider, so the test shows **Simulated** and no mail leaves the machine. Repeated preview keeps
the owner's changes.
For Console user sign-in diagnostics, run:

```sh
pnpm stand preview --id login-diagnostics --profile login-diagnostics
```

Use a checkout with the Console enabled; this profile refuses a disabled Console.
Sign in with the standard demo SUPER_ADMIN above. In **Users**, clear the
search and search one full email below, then open its name:

| Search email                      | Initial sample                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `login-local@preview.amcore.test` | Password configured, no linked accounts                                                |
| `login-oauth@preview.amcore.test` | No password, Google linked                                                             |
| `login-mixed@preview.amcore.test` | Password and Google, GitHub, Apple, Telegram; repeated Google identities show one name |
| `login-none@preview.amcore.test`  | No password and no linked accounts; a neutral setup state                              |

These four users are inspection targets, separate from the two demo sign-in
accounts. Linked identities and five security events for the mixed sample are
synthetic. They do not prove external-provider login or a continuous history.
Open **Password confirmations** and **Access changes** on the mixed sample;
the other samples have no seeded security events. Older synthetic events can
leave the current 31-day search window; select their original period in Audit.

Repeating the same command preserves sample edits and deletions, including
removed links. It never recreates a deleted sample or resets its state. If
only these samples changed, repeated preview still succeeds. Login and role
verification applies to the two demo sign-in accounts, not these four targets.
The Console diagnostics do not offer rename, delete or unlink actions; any
sample changes require the relevant supported product action or an admitted
fixture tool, never an ambient database connection.

If sample preparation reports an interrupted result, it refuses automatic
reseeding. After the command has exited normally, keep the data for inspection
or choose a fresh stand ID for initial examples. This message alone does not
require deletion. If an interrupted managed run left a lease or child processes,
follow the recovery procedure before further managed commands. Do not purge
merely to repair an edited sample.

`pnpm stand down --id login-diagnostics` stops this stand and keeps its data.
`pnpm stand down --id login-diagnostics --purge` deletes its proved-owned data
and resources, including later reviewer changes. Purge is a deliberate deletion
choice, not a requirement for inspecting or retaining sample changes.
For a managed command that reports a retained lease, wait for its supervisor and
recorded children to stop. Then use `pnpm stand recover --id login-diagnostics`
to recover while retaining database volumes, or add `--purge` to delete them.
Recovery checks process absence and ownership itself; a refusal is not permission
to remove the lease manually. See [cleanup safety](#target-and-cleanup-safety).
After successful purge, the record remains in state `purged` and its resources
are absent. A purged ID is not reusable; create a new ID for a fresh dataset.

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

A container additionally needs evidence that this Compose allocation created it:
because a container inherits its image's labels, a `docker create` from one of the
stand's own images would otherwise look owned. A container must carry the
`com.docker.compose.container-number` label and a `com.docker.compose.project.working_dir`
equal to the stand source snapshot (or one of its earlier approved snapshots), labels
Compose sets on containers it creates and an image never carries. A container without
them is not adopted: cleanup refuses and preserves it and the images it uses.

### Built images and unresolved builds

The images a stand builds (`migrate`, `api`, `worker`, `web`) carry the same ownership
labels as its containers, through `build.labels` in the generated override. Purge
(`down --purge`, `recover --purge`, `down --orphan --purge`, the end of every Docker
e2e run, and `closeout`) removes only images that pass a physical proof: the stand's
UUID, attempt and worktree labels, a Compose project label that matches when present,
and references that are all among the stand's own generated
`<project>-<service>:latest` names (a dangling generation has none). One image may
carry several of them: some engines (the classic image store on Linux) merge identical
builds, so `api` and `worker` become one image with two names and a single service
label, which is why the service label is not part of the proof. Discovery is a
label census (`image ls -a --no-trunc`), so older generations and partial or
interrupted builds are found even when the stand's current image map does not list
them. Images are removed last, after the stand's containers. An image that carries
several of the stand's names is untagged name by name, but one own name stays as an
anchor until the final removal by full image ID (the engine deletes an image together
with its last remaining reference, whatever it is, and refuses while a second one
exists). The ownership proof is repeated before every step, and each name is resolved
to the proved image ID before it is untagged. Nothing is forced and parent images are
never pruned. A foreign tag or alias present at the start, or any container in any
state that uses the image, refuses removal before anything changes. Containers are
inspected by full ID. If an unrelated container disappears after listing, cleanup
skips it only after a successful fresh inventory confirms its exact ID is absent.
Incomplete inspection, permission or transport errors still refuse disposal. A foreign alias
or a consumer that appears while the removal runs is preserved: it fails the repeated
proof or makes the engine refuse the final removal, and cleanup reports failure
(partial: some own names may already be gone). That protection for an alias depends on
the retained anchor: a dangling image has no own name and therefore no anchor, so a
single foreign alias added to it after the last proof becomes its only reference and is
deleted together with the image. Docker has no compare-and-delete, so a name rebound,
or an alias added, between a check and the operation that follows it cannot be
excluded (the length of that interval is not bounded here); this is the same
cooperative boundary as the rest of the stand tooling. Success requires a fresh census
proving absence; a zero exit status alone is not proof.
Base images that Compose or Testcontainers pull (`postgres`, `redis`, `node`,
`testcontainers/ryuk`) are never labelled and never touched. Ordinary `down` and a
source refresh keep the images so a restart stays fast. Images built before this
behavior carry no labels and are left alone; removing them is a deliberate manual
step outside the managed commands. Image removal frees the engine's image records;
the disk actually recovered depends on shared layers, and the BuildKit build cache
(including the pnpm cache mounts below) is a separate store these commands do not touch.

Before `compose build` runs, the stand records the attempt in its manifest. Only a
successful, unsignalled return of the command (exit 0) settles it; an exit 0 that
follows a signal this process sent to any managed group while the build ran (for
example Ctrl-C) does not count. A non-zero exit, a signal such as Ctrl-C, a spawn or
transport error, or a crash leaves the attempt
**unresolved**, because a host-side result does not show whether the Docker daemon is
still exporting an image for this stand. Purge still removes everything it can
prove, but reports cleanup incomplete, keeps the stand record and its source, and
`closeout` refuses until the attempt is resolved. A new build for the same stand
is refused while an attempt is unresolved, and a later successful build never hides
an older one. Resolve it by explicit risk acceptance:

```sh
pnpm stand down --id <stand-id> --purge --accept-unresolved-build "<reason>"
pnpm stand recover --id <stand-id> --purge --accept-unresolved-build "<reason>"
```

Use `down` after a cleanup failure with a released lease and `recover` after an
interrupted run that retained its lease. Neither runs migrations, needs the database
marker or an intact original source. The reason is stored in the manifest as an
acceptance record, not as proof of completion. `closeout` verifies physical absence
as usual and reports every accepted attempt and its reason separately (`ACCEPTED RISK`
lines, the manifest's `closeout.acceptedRisk`, and a final message that says only
physical absence was verified): acceptance does not prove that no late image export
remains. It is a maintainer decision: agents must not pass the flag on their own
authority. Engine-side build status (a Docker build-history record per service)
could prove that a build finished, but it needs a newer buildx plugin and has short
retention, so it is not used yet.

An ordinary removal failure is a different case and is never resolved by accepting
risk: a foreign tag or alias on a stand image, a foreign container that still uses it,
or a failed or unverified removal. Purge keeps what it has already removed
(containers, networks, volumes, proved images), records `cleanup-failed` with the
reason in the manifest (replacing any earlier state, including `purged`), keeps the
record and source, and exits non-zero. Remove or resolve the foreign reference (for
example `docker image rm <alias>` or `docker rm <container>`) and rerun
`pnpm stand down --id <stand-id> --purge`, or `recover --id <stand-id> --purge` when a
lease was retained; retries are safe. An unresolved build records `cleanup-incomplete`
instead, so the two are distinguishable. Every purge entry point (`down`, `recover`,
orphan purge, the end of an e2e run, the bind-race retry and `closeout`) records its
latest result the same way.

A lease covers startup, admission, tests and cleanup. Competing mutation commands
refuse. Docker E2E runs retain their allocated stand for cleanup when cancellation
interrupts the initial source copy. SIGINT/SIGTERM stops and awaits proved-owned process groups, including
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

### Product administration host rehearsal

Use `pnpm stand preview --id product-admin-preview --profile product-admin-three-host`
for separate website, staff and Console hosts. The copy-only fixture sets admin
placement to host mode and renders its matching edge mapping before the build.
`product-admin-console-path` retains Console on the website while isolating staff.
Neither profile changes the authoring placement source or bypasses authorization.

The `product-admin-real-stack` E2E lane targets the staff origin, with the other
exact owned origins available to same-browser checks. Its default fixture is
`product-admin-three-host`; `product-admin-console-path` and
`product-admin-closed-signup` are explicit alternatives. The closed-signup fixture
uses the isolated mail collector and step-free reports to avoid saving email-link
secrets. It is not an owner-preview dataset. Keep provider simulation and actual
provider-registration evidence separate.

For OAuth callback checks, select the E2E-only `product-admin-oauth` fixture
with the staff lane. It mounts a read-only API transport fixture and generates a
client signing key in the disposable snapshot. The fixture covers Apple signed identity tokens and Google/GitHub GET callbacks.
The real provider adapters and application auth path still run. This fixture cannot be used for owner previews;
it does not prove live Apple registration or an external Apple account login.
The staff Playwright configuration selects only the scenarios supported by the
chosen fixture. CI uses the same declared groups through
`node scripts/e2e-ci.mjs staff-oauth`; required inventory checks reject missing
or duplicated host specs. The full Web E2E aggregate includes the applicable
groups, rather than relying on a separate optional job.

For path administration OAuth, use
`pnpm stand e2e --lane real-stack --fixture product-admin-oauth-path -- product-admin-oauth-path.spec.ts`.
This copy-only fixture uses the existing Console-host HTTPS rehearsal and requires
an enabled Console. It keeps product administration in path mode and verifies
its shared website session. That fixture prerequisite does not apply to product
administration in deployed applications.

Staff transport remains HTTPS when Console is disabled or uses path mode.
Origins use different hostnames, not merely different ports. See
[placement and sessions](../product-admin/placement-and-sessions.md) for canonical
addresses and the difference between physical routes and public URLs.

For a bounded nginx TLS ingress check, use
`pnpm stand e2e --lane product-admin-real-stack --fixture product-admin-three-host --edge nginx -- product-admin-edge.spec.ts`.
This flag runs the dedicated wire probe instead of the browser suite. It creates
an owned nginx container with generated snippets, checks nginx configuration,
and uses loopback TLS requests with the configured public Host. It does not
replace browser auth or deployment on your own proxy.

### Browser trust

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

pnpm 12 reads these settings from `pnpm_config_*` variables; `npm_config_*` and
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
purges every proved-owned local stand, verifies that labelled containers, networks,
volumes and images (dangling and unrecorded ones included) are gone, refuses while a
stand still has an unresolved build attempt, and checks recorded process groups as well as source paths
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

## API compiler changes

Managed stands retain their isolated resource ownership with the ESM API.
For manual Nest watch sessions, see [API build guidance](../backend/api-build.md)
for asynchronous diagnostics and explicit restarts after configuration/shared changes.
A successful E2E preparation receipt does not certify compiled API freshness.

### Password limiter and visitor relay preview

Run `pnpm stand preview --id client-ip-preview --profile client-ip` in a path-mode
checkout. This isolated profile pins web to an unused address on its owned network;
API trusts that exact peer. Its HTTP browser proxy overwrites x-real-ip and removes
inbound internal claims. It proves wrong-password accounting and aggregate429, then
removes only its explicitly seeded demo keys. It never uses another stand/ingress.
The public preview URL remains useful for ordinary login/settings checks; the
trusted-edge proof runs through the profile's temporary browser proxy.
