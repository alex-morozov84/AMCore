# Shared package build contract

`@amcore/shared` uses tsdown with Rolldown for JavaScript and TypeScript 5.9
for declarations. The maintained builder replaces tsup. Declaration generation retains TypeScript 5.9.
`pnpm --filter @amcore/shared typecheck` checks sources with the pinned native
TypeScript 7 CLI. This partial adoption does not migrate frontend checks,
compiler API tools or declaration generation.

## Commands and outputs

Run `pnpm --filter @amcore/shared build` after changing shared contracts.
Run `pnpm --filter @amcore/shared dev` to rebuild on source changes.
Each build cleans `dist` before emitting dual ES2022 Node formats. The build is
unbundled: `dist` mirrors `src` module by module.

- ESM: `dist/index.js`, `dist/index.d.ts` and one `.js`/`.d.ts` per source module.
- CommonJS: `dist/index.cjs`, `dist/index.d.cts` and one `.cjs`/`.d.cts` per module.
- JavaScript source maps embed their source content. The entry files only re-export,
  so they have no map.

The package retains its existing root export conditions and `files: ["dist"]`.

## Import-time side effects are not allowed

`package.json` declares `"sideEffects": false`. Together with the unbundled output,
this lets the web bundler drop every shared module a route never imports, instead of
shipping all schemas to every page. The declaration is a promise about every module:

- A shared module may only declare values: constants, enums, schemas, functions.
- It must not register anything globally, configure Zod (`z.config`), patch
  prototypes, read the environment or write anywhere when it is imported.
- A value computed at import, such as `PRODUCT_ADMIN_CONFIG` validating its JSON,
  is allowed only when nothing outside the module depends on it having run.

This rule is a review convention, not a lint check. If a module truly needs an
import-time effect, list that file in `sideEffects` instead of breaking the promise.
Zod remains an external runtime and declaration dependency. Generated declarations
preserve inferred schemas; `isolatedDeclarations` is not required.
Declaration maps are disabled because the package does not ship its source tree.
A public build completion hook removes residual declaration map URLs left by
Rolldown after the declaration plugin discards those map assets. The hook processes
only declarations emitted by its build. It does not scan or rewrite another format's
files in the shared output directory. It does not alter types or JavaScript maps. Remove this normalization only after the artifact check
passes without it on an upstream fix.

## Verification and consumers

`pnpm test:scripts` includes package build/dev contracts in disposable copies.
Tools are linked into each build copy; dependency auto-install is disabled only
there to prevent writes through those links. Consumers receive only package
manifest, `dist` and Zod, without shared source or build tools.
Strict NodeNext ESM/CommonJS and Bundler fixtures exercise inferred inputs,
outputs, union discrimination and generic item types. Expected-invalid fixtures
must fail type checking. These are representative contracts, not semantic equality
of every exported type. Both runtime formats exercise the same parsing checks.
Clean, removed-module, mirrored output, build failure, source maps and watch checks supplement
shared source-level Vitest tests.

API preparation hashes the builder configuration and generated output. Run
`node scripts/api-e2e-ci.mjs --prepare` after installing dependencies or changing
those inputs. A stale preparation receipt must fail preflight; regenerate it with
real preparation. Both extension fixtures build shared through its package command
before preserving their original type and E2E checks.

API deployment, web standalone/Storybook and generated starter variants consume
this package. Full API E2E and the generated install/build/test matrix remain CI
requirements. Local transformation alone does not prove those variants build.

## Performance and rollback

Build speed affects developer and CI time, not application request latency.
Measure equal source, formats, target and maps before claiming a build improvement.
Repeated new processes do not represent a warmed compiler; operating-system
caches remain outside that comparison's control.

Native declaration emission remains a possible later choice. A stable native CLI
alone does not prove supported stable integration with the declaration plugin.
Reassess documented API support and compatibility together with measured speed.

Rollback restores package manifest, builder configuration, lockfile, export policy,
extension commands, artifact fixtures and preparation hash inputs together.
Clean `dist`, rebuild and regenerate the API preparation receipt afterward.
