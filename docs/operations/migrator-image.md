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
existing behavior. The final image needs no package or engine downloads.

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
Conflicting disconnect-check settings, duplicate `options` URL parameters and
malformed options fail without logging the connection URL. No fallback disables
the setting. The image uses the official Prisma CLI and engine, not a custom
SQL executor or cancellation supervisor.

Use a direct PostgreSQL endpoint that accepts and applies this session setting.
Confirm the effective value through the actual migration CLI before rollout.
With `DATABASE_URL` supplied by your secret manager, run the read-only preflight:

```sh
docker run --rm -e DATABASE_URL <amcore-api-migrator-image> \
  ./node_modules/.bin/prisma db execute --file ./migrator-check.sql
```

Require exit zero before running deploy against that endpoint. This is an explicit
operator preflight; the image does not run it automatically before each command.
Unknown, denied, ignored or zero settings do not satisfy this prerequisite.
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
   versions and prereleases manually.

Dependabot has a separate weekly non-major entry for `/docker/migrator`.
One-sided Prisma update proposals fail the version guard until reconciled.
Dependency freshness reports isolated dependencies and the installer separately;
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
migrator scan. Migrator SARIF includes HIGH/CRITICAL findings, including unfixed
ones. The full JSON inventory retains all severities and packages. Findings are
report-only; scanner errors and missing, malformed or wrong-image reports fail.
See [CI security](ci-security.md).

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
