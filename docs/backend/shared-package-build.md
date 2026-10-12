# Shared package build contract

`@amcore/shared` uses tsdown with Rolldown for JavaScript and TypeScript 5.9
for declarations. The maintained builder replaces tsup. The compiler remains
TypeScript 5.9; this change does not establish project compatibility with TS7.

## Commands and outputs

Run `pnpm --filter @amcore/shared build` after changing shared contracts.
Run `pnpm --filter @amcore/shared dev` to rebuild on source changes.
Each build cleans `dist` before emitting dual ES2022 Node formats:

- ESM: `dist/index.js` and `dist/index.d.ts`.
- CommonJS: `dist/index.cjs` and `dist/index.d.cts`.
- JavaScript source maps embed their source content.

The package retains its existing root export conditions and `files: ["dist"]`.
Zod remains an external runtime and declaration dependency. Generated declarations
preserve inferred schemas; `isolatedDeclarations` is not required.
Declaration maps are disabled because the package does not ship its source tree.
A public build completion hook removes residual declaration map URLs left by
Rolldown after the declaration plugin discards those map assets. It does not alter
types or JavaScript maps. Remove this normalization only after the artifact check
passes without it on an upstream fix.

## Verification and consumers

`pnpm test:scripts:fast` includes package build/dev contracts in disposable copies.
Tools are linked into each build copy; dependency auto-install is disabled only
there to prevent writes through those links. Consumers receive only package
manifest, `dist` and Zod, without shared source or build tools.
Strict NodeNext ESM/CommonJS and Bundler fixtures exercise inferred inputs,
outputs, union discrimination and generic item types. Expected-invalid fixtures
must fail type checking. These are representative contracts, not semantic equality
of every exported type. Both runtime formats exercise the same parsing checks.
Clean, removed-module, build failure, source maps and watch checks supplement
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
