# Temporary Next.js route-cache patch

Next.js 16.4.2 can duplicate a fragment when navigation returns to a route opened
with a fragment. For example, returning to `/login#section` can produce
`/login#section#section`.

`patches/next@16.4.2.patch` fixes the stored route-cache canonical URL in both
published module variants. Cache entries are shared across fragments. Their stored
URL must omit the fragment because the router appends the destination fragment.
The navigation URL itself retains its complete fragment and query.

This is a temporary local modification based on the normalization in
[open upstream PR96737](https://github.com/vercel/next.js/pull/96737), reviewed at
commit `5510443ed4aebe9ddc5ac168f6e33bd82da43716`. It is not a merged Next.js fix.
The patch excludes that PR's separate server-action redirect change. It does not
claim to fix every scenario covered by that PR.

## Installation

Work from the repository root with the Node version in `.nvmrc` and pnpm version in
`package.json`'s `packageManager`. Follow [Quick Start](../../README.md#quick-start).
Docker and Chromium prerequisites are in [managed stands](../operations/local-stands.md#prerequisites-and-commands).

pnpm applies the exact-version patch through `patchedDependencies` in
`pnpm-workspace.yaml`. The frozen lock records its hash. Keep normal patch failure
checks enabled; do not enable `allowUnusedPatches`.

The patch directory is an installation input for the web builder, API builder and
isolated migrator dependency stage. It must be copied before their installs.
Next.js remains absent from API and migrator runtime dependencies. Single-locale
and disabled-Console projects retain this generic navigation fix.

## Updating Next.js

1. Check the upstream issue/PR and the proposed release's actual cache implementation.
   Do not assume a newer version fixes the issue or widen the patch version range.
2. If the release fixes the invariant, remove the patch registration and patch file.
   Remove the Docker patch copies when no remaining patch requires them.
3. Regenerate the lock with the declared pnpm version. Verify clean frozen installation
   and each Docker install/deploy stage, including the filtered migrator graph.
4. Run production build/start or Docker browser checks without the local patch.
   Verify direct entry with a fragment, return navigation, fragment replacement/clearing,
   repeated query parameters and back/forward. Assert translated content and exact URLs.

```text
Official fixed release -> remove local patch -> frozen installs
    -> production build -> URL and content regression checks
```

After editing the reviewed dependency version, patch registration and files, use
`pnpm install --lockfile-only --ignore-scripts` to regenerate the lock without
running installation hooks. The following frozen install runs the normal hooks:

```bash
pnpm install --frozen-lockfile
node scripts/migrator-contract.mjs
pnpm stand e2e --lane real-stack -- route-fragment.spec.ts
```

The real-stack command builds the web/API images and isolated migrator dependency stage,
then runs production browser checks. The [migration-image guide](../operations/migrator-image.md)
also documents a direct migrator build. Keep required full checks and generated-project CI.

<!-- AMCORE_LOCALE_ROUTE_CACHE_PATCH_START -->

For multi-locale builds, also verify the language control and its profile policies:

```bash
pnpm stand e2e --lane real-stack -- locale-url.spec.ts locale-persistence.spec.ts auth-locale-profile.spec.ts
```

<!-- AMCORE_LOCALE_ROUTE_CACHE_PATCH_END -->

<!-- AMCORE_CONSOLE_ROUTE_CACHE_PATCH_START -->

For an enabled Operations Console in a multi-locale build, also verify its whole-page policy:

```bash
pnpm stand e2e --lane console-real-stack -- locale-profile.spec.ts
```

<!-- AMCORE_CONSOLE_ROUTE_CACHE_PATCH_END -->

If the reviewed version is still affected, port only the reviewed cache normalization
through [pnpm patch](https://pnpm.io/cli/patch). Replace the placeholder below with that
exact version. Remove the obsolete version's registration/file before updating the graph:

```bash
pnpm patch 'next@<reviewed-version>' --edit-dir .amcore/next-patch
# Edit the extracted CJS and ESM modules; review their current implementation first.
pnpm patch-commit .amcore/next-patch
pnpm install --frozen-lockfile
```

`patch-commit` writes the patch registration and lock hash. Do not edit the hash manually.
Keep exact-version registration and repeat the production commands above. A compatibility
review is required before porting; this procedure grants no automatic carry-forward.

If installation or regression checks fail, do not ship the candidate. Restore the previous
reviewed dependency manifest, workspace patch registration, lock, patch files and Docker
install inputs as one coherent change. Preserve unrelated edits. Reinstall frozen and
rebuild production outputs; do not reuse output from the failed candidate.

For check selection, see [frontend testing](testing.md).
The [upstream issue](https://github.com/vercel/next.js/issues/96714) tracks the defect.
