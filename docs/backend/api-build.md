# API build and ESM runtime

The API uses ECMAScript modules (ESM), Node's standard JavaScript module format.
Nest CLI owns compilation and development restarts. SWC emits JavaScript;
TypeScript checks types separately. Shared retains its ESM and CommonJS exports.

## Build and start

Use the declared Node and pnpm versions and install frozen dependencies:

```bash
pnpm install --frozen-lockfile
pnpm --filter @amcore/shared build
pnpm --filter api db:generate
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

The workspace `pnpm build` orders shared before its consumers through Turborepo.
Direct package commands require the shared build above. The E2E preparation
receipt covers Prisma generation and shared outputs; it does not prove API
JavaScript freshness. Build API explicitly before consuming its compiled output.

Configure the documented environment before starting a process:

```bash
pnpm --filter api start
pnpm --filter api start:prod
```

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

Use [managed local development](../operations/local-stands.md) when another
checkout runs or ordinary environment files point at remote resources. For a
manually configured local environment, `pnpm --filter api dev` runs stock
`nest start --watch`.

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
contracts, generated starter install/build/test and platform checks remain
required. Starter transforms alone do not prove a generated project builds.

## Choice and rollback

SWC uses the maintained Nest compilation integration. TypeScript 7 checking remains
independent of the JavaScript emitter. Keep frontend and compiler-API tooling on
their declared compiler versions.

Rollback must restore package mode, imports, Prisma generator, compiler/Jest
configuration, build/cache/Docker inputs and instructions together. Regenerate
the current Prisma schema and rebuild; verify process roles and all commands.
Do not revert domain/schema work or delete database, storage or Redis state.
