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

The final image contains Node 24, OpenSSL, certificates, Prisma's complete official
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

## Isolated installation and maintenance

`docker/migrator/package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml` define
an independent deployment graph outside the application workspace. The installer
pin includes its integrity hash. Preparation verifies its archive before
extraction and checks its actual version from an isolated working directory.
The published pnpm launcher verifies and obtains its platform executable through
the upstream distribution mechanism; neither installer is copied to runtime.

The preparation stage uses a frozen production install. This isolated graph
explicitly enables `minimumReleaseAgeStrict: true`, retaining the standard
24-hour cutoff. This is a project policy; pnpm also supports non-strict behavior.
Strict checking rejects newly published dependencies until that cooldown ends.
Wait for that boundary when a new Prisma release is too young. Do not add
release-age exceptions or disable the policy to get a passing build.

CI runs `node scripts/migrator-contract.mjs` before the image job through its
required lint dependency. It checks API CLI/client/adapter and migrator versions,
both lock resolutions, installer pin and the isolated workspace policy.

1. For a Prisma update, change the API CLI/client/adapter family and the isolated
   CLI to the same exact supported version.
2. Refresh both lockfiles with their declared package managers. Keep the root
   workspace package manager unchanged unless a separate migration is intended.
3. Run the version guard, frozen installs, image checks and migration/recovery
   tests. Commit the coherent update in one maintenance PR.
4. For isolated dotenv or transitive updates, refresh that graph without changing
   an unaffected root lock merely to produce a matching diff.
5. Update the isolated installer version and integrity together. Review major
   versions and prereleases manually. The installer version must equal the root
   `packageManager` pnpm version; `scripts/lib/toolchain-pins.test.mjs` fails on drift.

Dependabot has a separate weekly non-major entry for `/docker/migrator`.
One-sided Prisma update proposals fail the version guard until reconciled.
Dependency freshness reports isolated dependencies and the installer separately
(and the root pnpm pin in its Toolchain section);
the root recursive outdated command does not cover this directory.
The weekly recursive OSV scan includes the separate lockfile.

To refresh the isolated lock after editing its manifest, start at the repository
root. These commands use the declared installer rather than the workspace pnpm:

```sh
cd docker/migrator
migrator_tools="$(mktemp -d)"
node installer.mjs "$migrator_tools/pnpm"
node "$migrator_tools/pnpm/bin/pnpm.mjs" install --prod --lockfile-only
node "$migrator_tools/pnpm/bin/pnpm.mjs" install --prod --frozen-lockfile
rm -rf "$migrator_tools"
cd ../..
node scripts/migrator-contract.mjs
```

```text
manifest -> isolated lock -> frozen install -> version guard -> image -> database
```

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
