# API build and ESM runtime

The API uses ECMAScript modules (ESM), Node's standard JavaScript module format.
Nest CLI owns compilation and development restarts. SWC emits JavaScript;
TypeScript checks types separately. Shared retains its ESM and CommonJS exports.

## Build and start

Use the declared Node and pnpm versions and install frozen dependencies:

```bash
pnpm install --frozen-lockfile &&
pnpm --filter @amcore/shared build &&
pnpm --filter api db:generate &&
pnpm --filter api build
```

The API build runs the required TypeScript 7 application-only `typecheck:build`
first, using `tsconfig.build.json`. Test helpers and test roots are excluded.
The separate `pnpm --filter api typecheck` still checks source, tests and Prisma;
run it before delivery. Exclusion does not prevent runtime imports from reintroducing
test files. Keep test code outside production imports. Nest then
runs its retained compiler-API checker and SWC. The identity command runs only
when those stages succeed. Nest cleans `dist` before emission, so removed modules
cannot survive a successful rebuild. A failed build is not a deployable artifact;
never launch a remaining directory after an unsuccessful build.

After emission, the build writes the nonsecret MFA compatibility artifact. Set
`BUILD_SOURCE_COMMIT` to the reviewed commit for deployment images. Unpinned
local artifacts contain a null commit and cannot pass MFA deployment preflight.
Turborepo hashes this build-only input and the artifact writer.

The workspace `pnpm build` orders shared before its consumers through Turborepo.
Direct package commands require the shared build above. The E2E preparation
receipt covers Prisma generation and shared outputs; it does not prove API
JavaScript freshness. Build API explicitly before consuming its compiled output.

Configure the documented environment, then choose one command:
`pnpm --filter api start` to use the current environment, or
`pnpm --filter api start:prod` to set `NODE_ENV=production`.

Both commands execute `dist/main.js`. Production does not run Nest CLI, tsx or a
compiler. Keep API `package.json` with `type: module` beside its `dist` directory;
copying JavaScript without its package boundary changes Node's interpretation.
The standard Dockerfile preserves that boundary and includes the native checker
script in the builder stage. Migrations remain a separate one-shot deployment
step. See [deployment](../operations/deployment.md).

The runner packages compiled `dist`, `package.json`, the package README and
production dependencies. The Dockerfile also creates writable upload and GeoIP
directories. The `files` list in the API `package.json` controls what `pnpm deploy`
copies from the API package. Source, tests, Prisma schemas/migrations, tool configs
and API source maps stay out. Add any new API package asset read at run time to
that list. Dependency packages retain their own assets and packaging rules.
The CI step "Verify the runner image holds only runtime files" checks required
entrypoints and build identity. Outside `node_modules`, it rejects the listed
source/tool directories and spec, test, `*.testkit.*`, `*.map` and `*.ts` files.

The [migration image](../operations/migrator-image.md) uses its own frozen CLI
graph; it does not inherit this API build or move client generation to rollout.

## Development

Agents use [managed local development](../operations/local-stands.md) for database writes and previews.
Use managed local development when another checkout is running or your checkout points to remote resources.
For manual setup, start in a fresh checkout with Git, OpenSSL and Docker Compose v2.20.2 or newer.
Copy `.env.example` to `.env`. Keep `COMPOSE_PROFILES=local-infra` and leave `COMPOSE_DATABASE_URL`,
`COMPOSE_REDIS_URL` and `MIGRATION_DATABASE_URL` unset in the shell and the file.
Use only disposable local services.

For host package commands, use Node 24 from `.nvmrc` with the minimum patch in
`package.json` (currently 24.15.0) and its exact `packageManager` pnpm version
(currently 12.18.0). Check both versions before installing frozen dependencies.

For a managed rebuild-and-run loop with automatic local credentials, see [pnpm local](../operations/local-stands.md#develop-a-configured-product). The native watch setup follows below.

For the bundled PostgreSQL, set `DATABASE_URL="postgresql://amcore:amcore@localhost:5432/amcore?schema=public"`
in root `.env`. An exported `DATABASE_URL` takes precedence. Check the file value first.
The shell guard below stops before installation or migration if an exported value differs.
Use the same shell for the shared web/API key, native frontend origins and startup:

```bash
test "${DATABASE_URL-postgresql://amcore:amcore@localhost:5432/amcore?schema=public}" = 'postgresql://amcore:amcore@localhost:5432/amcore?schema=public' &&
WEB_FRONTEND_CONTEXT_KEY="$(openssl rand -hex 32)" &&
test -n "$WEB_FRONTEND_CONTEXT_KEY" &&
export WEB_FRONTEND_CONTEXT_KEY &&
export FRONTEND_URL=http://localhost:3002 WEB_TRUSTED_ORIGINS=http://localhost:3002 &&
# Migrate only a disposable local development database.
pnpm install --frozen-lockfile &&
docker compose up -d postgres redis &&
pnpm --filter api db:migrate &&
export REDIS_URL="redis://localhost:6379" &&
pnpm dev
```

The API reads root `.env`; exported values override it. Web does not read that
file, so export `WEB_FRONTEND_CONTEXT_KEY` and `REDIS_URL` in the shell running
`pnpm dev`. Strict Turbo passes those and `FRONTEND_URL`, `PRODUCT_ADMIN_ORIGIN`,
`WEB_TRUSTED_ORIGINS`; it builds shared before dependent dev processes.
Native web listens on port 3002. `FRONTEND_URL` and `WEB_TRUSTED_ORIGINS` must
name the address where you open web (normally `http://localhost:3002`), not the
Docker web address (http://localhost:3000). Export changed origin settings so API and web agree.
Without a key, web refuses startup. With mismatched keys or missing web Redis
configuration, startup can succeed but session bootstrap returns 503. A listening
process is not working authentication. For separate package starts,
run `pnpm --filter @amcore/shared build` first. Then `pnpm --filter api dev` runs Nest in watch mode.

On failure, retain the first error and stop before retrying migrations or changing database state.

Nest/SWC's development checker reports diagnostics asynchronously. A listening
HTTP endpoint or a restarted process does not prove a fresh TypeScript 7 check.
Run `pnpm --filter api typecheck` explicitly and require the CI type/build gates.
Do not bypass failures because JavaScript transpilation succeeded.

After changing compiler configuration, dependencies, environment, Prisma schema
or shared exports, stop the API, regenerate/rebuild the affected package, and
restart it. Automatic observation of external shared/config inputs is not a
supported promise. Shared's own build/watch remains separate from Nest's watcher.
No application-owned watcher, readiness protocol or process supervisor is needed.

## Imports and extensions

Use explicit `.js` paths in runtime relative imports, including `/index.js` for
barrels. TypeScript resolves these to source `.ts`/`.tsx`; Node resolves emitted
JavaScript. New modules must follow the same rule. Prefer relative runtime
imports inside API; test aliases remain available through Jest configuration.
Use `import.meta.dirname` or standard URL helpers instead of CommonJS globals
in runtime modules. Keep legitimate `.cjs` test/configuration boundaries.

Prisma generates ESM with `.js` imports. Change its generator configuration and
regenerate the current schema together; do not copy generated files from another
checkout.
SWC preserves legacy decorator metadata, class names and React JSX transformation.

## Operator commands

From `apps/api`, the compiled entrypoints are:

```bash
node dist/cli/geoip-update.js
node dist/cli/telegram-setup.js
node dist/cli/storage-check.js
node dist/cli/organization-setup.js status
```

The application entrypoint is `node dist/main.js`. Before running an operator
command, follow its setup and permission guide:

- [GeoIP setup](../operations/geoip-setup.md).
- [Telegram webhook deployment](../operations/deployment.md#telegram-webhook-registration-one-shot-optional).
- [Storage checks](../storage/README.md).
- [First organization setup](../product-admin/organization-establishment.md).

Telegram, storage and organization-setup commands compare canonical file URLs
before execution. Importing these modules does not run their commands.
Invocation through a symlink remains supported. GeoIP always runs as an executable command.
Organization setup requires trusted deployment access.
The [first organization guide](../product-admin/organization-establishment.md)
explains the creation policy, account preparation, mailbox proof, completion and safe repeats.
Source operator scripts retain tsx; see [storage checks](../storage/README.md)
and existing package commands.
Never use real provider credentials for test fixtures.

## Tests and downstream changes

API units retain Jest's CommonJS transformation. E2E retains Jest's ESM
transformation and isolated Testcontainers workers. Their configs are ESM;
`jest-swc.config.cjs` deliberately remains CommonJS. Keep decorator metadata and
relative `.js` mapping in both paths. Email retains Vitest.

A module that only tests import (a fixture, a fake, a corpus) is named
`*.testkit.ts`. The production build excludes that suffix, as it does `*.spec.ts`,
`*.test.ts` and `*-spec.ts`: keep the list in `.swcrc` and `tsconfig.build.json`
in step. Do not add test-only code to a name the build does not exclude, or it
ships in `dist`.

Run affected unit, schema/type-negative, compiled-command and E2E contracts after
changing module or compiler configuration. Full API E2E, all repeated extension
contracts and platform checks remain required.

## Choice and rollback

SWC uses the maintained Nest compilation integration. TypeScript 7 checking remains
independent of the JavaScript emitter. Keep frontend and compiler-API tooling on
their declared compiler versions.

Rollback must restore package mode, imports, Prisma generator, compiler/Jest
configuration, build/cache/Docker inputs and instructions together. Regenerate
the current Prisma schema and rebuild; verify process roles and all commands.
Do not revert domain/schema work or delete database, storage or Redis state.
