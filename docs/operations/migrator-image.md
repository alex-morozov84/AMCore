# Migration image

The `migrator` target in `apps/api/Dockerfile` runs the official Prisma CLI as a
non-root one-shot process. Build it from the same source commit as the API runner:

```sh
docker build -f apps/api/Dockerfile --target migrator -t amcore-migrator .
```

Run it through the existing `migrate` Compose service before deploying API and
worker processes. Production promotion uses immutable image digests; see
[deployment](deployment.md#migration-contract) and the
[production deploy profile](production-deploy-profile.md).

## Contents and commands

The final image contains Node 24 on Debian Trixie, OpenSSL, certificates, Prisma's complete official
dependency tree, an image-specific Prisma configuration, schema files and SQL
migration history. The configuration composes the unchanged API base configuration.
Its working directory remains `/app/apps/api`. The default command is
`./node_modules/.bin/prisma migrate deploy`. Operators can override it with the
same local CLI for `--version`, `migrate status` and `migrate resolve`.

The final stage does not inherit the API build stage. It excludes npm, Corepack,
pnpm, installer caches and the API's compiler/test/lint graph. Prisma's own CLI
dependencies remain intact, including development and Studio support packages
that the published CLI declares. Do not remove their files to silence findings.

Generation remains part of the API build. `migrate deploy` does not generate a
client or run the seed command. Host `db:generate` and `db:seed` retain their
existing behavior. Managed stands use a separate API-build seed service; they do
not execute seed through this image. The final image needs no package or engine downloads.

The operating-system user and the database role are separate controls. Use the
schema-owning migrator database role only for this job, through
`MIGRATION_DATABASE_URL`. API and worker connections use the runtime role.
See [database role separation](database-role-separation.md).

## Process and database lifecycle

The final image includes Debian's Tini init process with process-group signal
forwarding. Keep its entrypoint when running Docker, Compose or Kubernetes.
Use the default command for deploy. For status, override only the command
arguments with `./node_modules/.bin/prisma migrate status`; Kubernetes uses
`args`, leaving `command` unset. An orchestrator's ordinary init option does
not replace this image contract. Signal exits remain failures.

Only the image's Prisma configuration adds the PostgreSQL startup option
`client_connection_check_interval=50ms`. It preserves the API configuration's
datasource selection and leaves API/worker URLs and database role defaults
unchanged, including shared-role Compose deployments. This interval checks for
a closed client socket during SQL; it does not limit normal statement duration.

Existing startup options keep PostgreSQL whitespace/backslash escaping.
Conflicting disconnect-check settings, duplicate `options` or `pgbouncer` URL parameters and
malformed options fail without logging the connection URL. No fallback disables
the setting. The image uses the official Prisma CLI and engine, not a custom
SQL executor or cancellation supervisor.

### Supported configuration boundary

Default deploy and local CLI `migrate status` / `migrate resolve` arguments
keep the image's `prisma.config.mjs` and Tini entrypoint. Other CLI arguments
must preserve both and the selected datasource URL to retain this lifecycle
contract. The base file `prisma.base.config.ts` lacks the required image setting.
Do not use `--config ./prisma.base.config.ts` for a production migration.

An alternative `--config`, `--url`, mounted replacement configuration, or
`--entrypoint` can bypass the checked path. It requires separate lifecycle
admission before use; a successful default preflight does not cover it.
An ordinary init flag does not establish equivalent process-group forwarding.
Production must not set the test-only `E2E_DATABASE_URL`: it takes precedence
over `DATABASE_URL` in the inherited configuration.

### Endpoint preflight

Use a direct PostgreSQL endpoint that accepts and applies this session setting.
Confirm the effective value through the actual migration CLI before rollout.
Use the exact promoted migrator digest and that environment's migration
credential. For standalone Docker, have your secret manager export the selected
URL as `DATABASE_URL`; do not put its value in a command line or report.

```sh
docker run --rm -e DATABASE_URL <amcore-api-migrator-image>@sha256:<digest> \
  ./node_modules/.bin/prisma db execute --file ./migrator-check.sql
```

For a hostname reachable only inside Compose, run through the existing service.
Use the same project name, environment file and profiles as the rollout. The
following commands run from the repository root using the production overlay;
its required image variables must contain the promoted digests. The target
PostgreSQL service must already be running and healthy: `--no-deps` does not
start infrastructure.

```sh
docker compose -f docker-compose.yml -f docker/compose/prod.yml \
  run --rm --no-deps migrate \
  ./node_modules/.bin/prisma db execute --file ./migrator-check.sql
```

The service joins its configured Compose network and selects
`MIGRATION_DATABASE_URL`, falling back to `COMPOSE_DATABASE_URL` or the bundled
PostgreSQL URL. Do not substitute an API/runtime credential or an unrelated
host URL to make this check pass. Do not print `docker compose config` output
containing secrets into logs or review material.

### Custom CA and network access

Keep certificate verification enabled. For Prisma's native CLI, the selected
URL must use `sslmode=require`, `sslaccept=strict` and an `sslcert` path matching
the certificate file **inside** the container. Supply the URL through the secret
manager. The CA file contains the trusted certificate, not its private key.

For standalone Docker, choose an existing network that reaches the exact
endpoint. Replace the bracketed image/network values and absolute host path:

```sh
docker run --rm --network <migration-network> -e DATABASE_URL \
  --mount type=bind,src=/absolute/path/migration-ca.pem,dst=/run/secrets/migration-ca.pem,readonly \
  <amcore-api-migrator-image>@sha256:<digest> \
  ./node_modules/.bin/prisma db execute --file ./migrator-check.sql
```

Here the URL contains `sslcert=/run/secrets/migration-ca.pem`. The non-root image
user must be able to read the mounted file. Preserve the same network, CA mount,
URL and digest when running deploy. Do not disable TLS verification on refusal.

For Compose with a custom CA, create a local overlay such as
`migration-ca.override.yml`. Replace the absolute host path with your CA file:

```yaml
services:
  migrate:
    volumes:
      - type: bind
        source: /absolute/path/migration-ca.pem
        target: /run/secrets/migration-ca.pem
        read_only: true
```

Set the selected migration URL's `sslcert` to that container path. Apply the
same overlay to preflight and deploy, preserving the other rollout settings:

```sh
docker compose -f docker-compose.yml -f docker/compose/prod.yml \
  -f migration-ca.override.yml run --rm --no-deps migrate \
  ./node_modules/.bin/prisma db execute --file ./migrator-check.sql
# Only after the preflight exits zero:
docker compose -f docker-compose.yml -f docker/compose/prod.yml \
  -f migration-ca.override.yml run --rm --no-deps migrate
```

```text
promoted digest + migration URL + network + trusted CA
  -> actual CLI preflight -> exit zero -> deploy with the same settings
```

Require exit zero before running deploy against that endpoint. This is an explicit
operator preflight; the image does not run it automatically before each command.
Unknown, denied, ignored or zero settings do not satisfy this prerequisite.
If the image, selected endpoint/URL, credential, CA or configuration changes,
repeat the preflight for that exact combination. A failed check stops rollout;
retain a secret-free error and investigate the connection or endpoint capability.
Managed-provider support requires evidence for the selected version and endpoint;
the presence of a provider parameter in documentation is insufficient.
No bounded network-blackhole guarantee follows from this setting: detection
also depends on the server kernel and TCP failure detection.

Container exit and database cleanup are separate checks. Recovery after an
interrupted migration must inspect the ledger and any partial SQL before using
`migrate resolve`. Image replacement does not undo SQL that already committed.

## Installation and maintenance

The private workspace package `@amcore/migrator` at `docker/migrator/package.json`
selects Prisma CLI and dotenv. The repository's root `pnpm-lock.yaml` owns their
resolutions. There is no second source lockfile or custom installer. Root frozen
installation includes this package; keep its Prisma version equal to the API CLI,
client and adapter versions.

Docker prepares the package in a separate Node24/Trixie stage. It copies the
complete `/opt/pnpm` from the official glibc pnpm image, pinned by version and
index digest. The directory includes node-gyp; copying only its executable is
insufficient. The package-manager version must match root `packageManager`.
See [pnpm's Docker guidance](https://pnpm.io/docker).

Preparation installs only the selected package with frozen resolutions and
`--ignore-scripts`. It then uses non-legacy `pnpm deploy --prod` to create the
portable production directory. Deploy runs dependency scripts allowed by root
`allowBuilds`, including Prisma's engine download. Root and API authoring hooks
must not run in this stage. Preparation receives no migration credential.
Inside Docker preparation, both commands inherit `pnpm_config_frozen_lockfile=true`:

```sh
HUSKY=0 pnpm --filter @amcore/migrator --fail-if-no-match install --prod --frozen-lockfile --ignore-scripts
HUSKY=0 pnpm --filter @amcore/migrator --fail-if-no-match deploy --prod /prod/migrator
```

These are container preparation commands, not replacements for development checkout
installation. The final stage copies the deployed directory, config and SQL, without the store,
package manager, workspace or API build output.

Prisma's official graph can include its optional TypeScript5 peer. That is distinct
from the API's native TypeScript7 compiler. Preserve official peer packages and
platform engines. An ambiguous peer resolution, unexpected hook, missing engine
or changed unrelated resolution stops the update. Return to review; do not use
legacy deploy, overrides, compatibility forks or manual pruning as a workaround.

The root workspace applies the strict24-hour release-age floor and rejects missing
publication times. Its allowBuilds policy also applies to migration dependencies.
Wait when a release is too young; do not add exclusions or disable these policies.
Frozen installation fixes versions; it does not prove that those versions are safe.

### Update dependencies

Start from the repository root with its supported Node and pinned pnpm version.
Use a development checkout without production credentials.

1. For a Prisma update, set API CLI/client/adapter and the migration CLI to the
   same exact supported version in `apps/api/package.json` (`prisma` in
   devDependencies; `@prisma/client` and `@prisma/adapter-pg` in dependencies) and
   `docker/migrator/package.json` (`prisma` in dependencies). For another
   dependency, edit its owning manifest.
2. Generate the root lock and run the frozen installation and coherence guard:

   ```sh
   pnpm install --lockfile-only --ignore-scripts
   pnpm install --frozen-lockfile
   node scripts/migrator-contract.mjs
   ```

   Review every changed resolution. The second command runs normal development
   lifecycle hooks, including API client generation and Husky. It is not the
   isolated Docker preparation command.

3. Build the migration target with the command at the top of this guide. Verify
   the CLI and engine without package-registry access, then test migrations,
   signals, roles, TLS and recovery on both supported architectures.
4. For pnpm updates, update root packageManager, existing Docker Corepack pins,
   the stand installer fixture and the official migration bootstrap image together.
   These pins live in `package.json`, `apps/api/Dockerfile`, `apps/web/Dockerfile`,
   `scripts/stand/linux-startup.test.mjs` and the `migrator-pnpm` stage of
   `apps/api/Dockerfile`. Search the pinned version across the checkout before editing;
   the coherence tests reject a partial update.
   Resolve the exact image's index/platform digests, inspect upstream build/source
   provenance and check executable identity/version on ARM64 and native AMD64.
   Copy the whole matching-libc distribution. Stop on a mismatch; do not substitute
   an unreviewed downloader or treat provenance metadata as a verified signature.
5. Commit the coherent dependency, lock, pins, guard and documentation changes
   together after the required checks. Promote image digests from the same source
   state; do not install packages when the migration credential is present.

The root Dependabot npm entry covers the package with its existing schedule,
three-day cooldown and non-major policy. Root recursive outdated and OSV scans
cover the shared graph; there is no nested updater or separate freshness list.
CI runs `node scripts/migrator-contract.mjs` through its required lint dependency.
The guard checks coherent manifests/resolutions, the reachable migration graph,
minimal package boundary and root release-age policy.

```text
minimal manifest + root lock -> filtered preparation -> deploy output
  -> fresh migration image -> endpoint preflight -> migration -> app rollout
```

For a package-manager update, inspect the selected official image before changing
its pin. Replace the version and digest with the proposed values:

```sh
docker buildx imagetools inspect ghcr.io/pnpm/pnpm:<version>@sha256:<index-digest>
docker build -f apps/api/Dockerfile --target migrator-dependencies -t amcore-migrator-preparation .
docker run --rm --network none amcore-migrator-preparation sh -ec '
  test "$(command -v pnpm)" = /usr/local/bin/pnpm
  readlink -f /usr/local/bin/pnpm
  pnpm --version
  sha256sum /opt/pnpm/pnpm /app/pnpm-lock.yaml
  ldd /opt/pnpm/pnpm
'
```

Check the resolved path is `/opt/pnpm/pnpm`, the declared version matches, and no
library is missing. Match each platform digest and executable/archive hash to
the upstream release and build provenance. These commands inspect identity;
they do not verify a publisher signature. Run them natively on both architectures.
For the required two clean preparation samples, use two new disposable BuildKit
builders: `--no-cache` alone does not clear named package-store cache mounts.
Compare unchanged lock hashes, dependency identities, engine hashes and hook
traces/sentinels. This is additional update-admission evidence; neither the
coherence guard nor one ordinary image build provides it.

### Verify cancellation in a development checkout

After installing root frozen dependencies and building the image, run:

```sh
node scripts/verify-migrator-lifecycle.mjs amcore-migrator
```

This test creates its own PostgreSQL18 Testcontainer and network on the local Unix
Docker engine. It uses no checkout database URL. The migrator joins only an internal
fixture network; the host observer uses PostgreSQL's published port separately.
The image architecture must match the engine architecture. TERM and INT each
interrupt a confirmed PostgreSQL `PgSleep`, with and without an explicit transaction.
The original45-second natural-exit deadline and200ms session/lock observation from
the attached process's `exit` event remain fixed; diagnostic disposal cannot produce a pass.
This command checks cancellation and transactional rollback. Dependency updates
also require the broader CLI, roles, TLS, migration-history and recovery checks above.
The case without an explicit transaction does not prove partial-commit recovery.

The command prints a recovery journal path at startup. It records failures before
forced disposal and retains the journal when resource cleanup fails. After an
interrupted command has stopped, retry cleanup with its printed absolute path:

```sh
node scripts/cleanup-migrator-lifecycle.mjs /absolute/path/to/resources.json
```

Cleanup checks the recorded run label before removing each resource; it refuses
foreign resources. CI uses a fixed runner-temporary journal path and an independent
cleanup step, including when the verification process cannot handle a stop signal.
Missing journals require no cleanup. A cleanup error remains a failed check;
it cannot turn the original lifecycle failure into a pass.

### Verify roles, TLS, history and recovery

Use a development checkout, frozen API test dependencies, Docker and OpenSSL on
the host. Build the image from the same source state. First check its CLI without
network access:

```sh
docker run --rm --network none amcore-migrator ./node_modules/.bin/prisma --version
node scripts/verify-migrator-operations.mjs amcore-migrator
```

The second command creates its own TLS-enabled PostgreSQL18 fixture. It checks
the current SQL inventory and ledger checksums, no-op deploy, status, database
roles, runtime permissions, the preceding migration's upgrade with data, invalid
credentials/CA, effective startup settings, partial commits, resolve and backup/restore.
Its login-audit trigger exists only in the disposable fixture; production does
not need that trigger or a superuser migration role. Endpoint simulations do not
prove support on a managed provider. Run the separate endpoint preflight there.

For a packaging comparison, pass a locally available baseline image as a second
argument. Both images must match the native Docker architecture:

```sh
node scripts/verify-migrator-operations.mjs amcore-migrator amcore-migrator-baseline
```

This adds baseline CLI status against the current schema. It does not prove
application compatibility or replace paired preparation and scanner comparisons.

Check the negative controls separately. Choose an existing writable directory;
the journal path must be absolute and must not already exist:

```sh
export AMCORE_MIGRATOR_LIFECYCLE_JOURNAL=/absolute/path/to/migrator-controls.json
node scripts/verify-migrator-controls.mjs amcore-migrator network
node scripts/verify-migrator-controls.mjs amcore-migrator interrupt
node scripts/verify-migrator-controls.mjs amcore-migrator negative
node scripts/verify-migrator-controls.mjs amcore-migrator advisory
```

Run one command at a time. Stop and investigate any nonzero exit.
`network` checks a reachable canary outside the internal network, denies its
route from that network, injects resource-removal failure and independently
recovers the journal. `interrupt` stops the real lifecycle command with TERM,
INT and KILL after confirmed active SQL. It uses journal suffixes `.sigterm`,
`.sigint` and `.sigkill`. After a stopped run, recover any retained journal with
the cleanup command above, including each suffix.
The other control modes reuse exactly the base journal; they have no hidden
journal suffixes. The operations command uses its printed journal, or the base
path when that environment variable is set. CI chooses separate files under
`$RUNNER_TEMP`: `migrator-lifecycle.json`, `migrator-operations.json`,
`migrator-network.json`, `migrator-negative.json`, `migrator-advisory.json`, and
`migrator-interrupt.json.sigterm`, `.sigint`, `.sigkill` with the same prefix.

`negative` deliberately bypasses Tini or the image configuration. It requires
the original45-second or200ms admission to fail. These are test fixtures,
not supported production alternatives. `advisory` interrupts the CLI while it
waits for a deliberately held Prisma advisory lock. Its200ms observation permits
only the known blocker; the separate lifecycle command still requires zero
sessions and locks. After closing the blocker, the control also requires zero.

Run the commands on native ARM64 and native AMD64 engines. Emulation does not
satisfy native admission. The hosted Docker smoke job declares these runtime
checks and independent cleanup; a local PASS does not mean that CI has passed.
Record image IDs, architecture, source revision and structured run IDs without
credentials. Successful disposal deletes fixture databases, keys and journals.
The full dependency inventory, frozen preparation repeats, application rollout
and required CI remain separate verification gates.

## Security reports and remaining risk

CI keeps the existing runner scan and adds an independent vulnerability-only
migrator scan. Migrator SARIF, which feeds the Security tab, includes only
HIGH/CRITICAL findings that have a fixed version, the same policy as the runner
scan (`--ignore-unfixed`). The full JSON inventory retains all severities, packages
and unfixed findings, so nothing is hidden: it is uploaded as a CI artifact. A
finding enters the Security tab on the first scan after its fix is published.
`trivy convert` has no unfixed filter, so the script filters the inventory itself
and checks the SARIF against the same rule. Findings are report-only; scanner
errors and missing, malformed or wrong-image reports fail. See
[CI security](ci-security.md).

A smaller final image does not fix tools used earlier by the API builder.
Its npm, pnpm and compiler require their own supported security maintenance.
A compromised dependency installation can affect an artifact before the
installer is removed. Review that residual supply-chain risk before production;
an empty filtered scan does not establish safety or exploitability.

For comparisons, use the same architecture, Node digest, scanner database and
filters within each baseline/candidate pair. Record installed Debian package
versions separately: apt security refreshes can differ under the same base digest.
ARM64 evidence does not substitute for AMD64 evidence. Include Debian's Tini
package in each architecture's inventory and advisory review. Rebuild with
supported Debian security updates and repeat affected scans after package changes.

Changing an image does not undo applied SQL. Use the documented
[rollback and recovery](deployment.md#rollback) process and verify restored
ownership and permissions; `migrate resolve` changes migration bookkeeping only.
