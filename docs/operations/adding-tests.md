# Adding tests

Choose the smallest test that proves the changed risk. Use the existing family
and runner. A file's existence alone does not prove that CI executes it.

Before adding a case, name the defect or guarantee and inspect existing coverage.
Extend an existing case when it proves the same contract. Do not add a test for
every implementation branch or retain one only because it passes.

Distinguish product behavior from starter checks: generated/copied fixture tests
prove the extension recipe, while product tests prove the application's own behavior.
Also name the boundary: logic, component, adapter, real dependency or assembled system.
An E2E filename alone does not establish which boundary runs.

Before replacing an expensive case, identify the retained guarantee, smaller
replacement and lost coverage. Show that a relevant deliberate defect fails the
replacement, then restore the source and require a passing result. Keep real SQL,
Redis/Lua or browser-to-API witnesses when the defect depends on that boundary.
If the replacement cannot prove the guarantee, retain the old case.

Assert the outcome and relevant state after a refusal. Test each independent bad
input with a fresh fixture. Keep causal journeys together when a later action needs
the earlier result. Use a controlled clock for exact timer boundaries; never replace
a negative time window with an immediate assertion. Record the first failed attempt
and distinguish setup, discovery and transport failures from assertion failures.

## Backend unit tests

Add co-located `*.spec.ts` files under `apps/api/src`. Existing Jest discovery
includes them in `pnpm --filter api test` and the CI unit+Redis group.
Mock infrastructure for isolated logic. Use real dependency integration for SQL,
transactions or Lua; use HTTP when request/response wiring is the assertion. See [backend conventions](../backend/architecture-and-conventions.md).

## Backend E2E

Add `*.e2e-spec.ts` under `apps/api/test`. Use the existing helpers, owned-container
labels and cleanup. Install dependencies first and make Docker available. From
the repository root:

```sh
node scripts/api-e2e-ci.mjs --prepare
pnpm --filter api test:e2e --runTestsByPath test/oauth.e2e-spec.ts
```

The supervisor discovers ordinary files automatically and assigns each exactly
once to the complete API plan. Inspect the runner discovery for the current inventory;
there is no required suite count.
Do not add a focused CI call for every feature. No skipped, focused-only or retried
declarations are admitted. Each child must exit naturally and clean its resources.
Source or build-config changes can invalidate preparation; prepare again when needed.
Use separate absolute `API_E2E_OUTPUT` directories when retaining multiple focused
reports. `pnpm --filter api` runs from `apps/api`, so relative output paths start
there rather than at the repository root.
See [local isolation](local-stands.md) and [CI gates](ci-security.md#current-gates).

## Frontend

Use the existing [frontend testing taxonomy and commands](../frontend/testing.md).
It defines unit/component, mocked integration, real-Redis integration, component
states and browser tests. Real Redis vault/Lua/CAS behavior belongs in
`src/**/*.integration.test.ts`, run by `pnpm --filter web test:integration`.
This Docker-backed family runs after unit tests in the `Test unit and Redis` CI
job; ordinary mocked unit tests cannot replace it. Follow that family's cleanup
and lifecycle helpers.

## Extension conformance

`pnpm test:capability-extension` proves the starter's extension recipe on a patched
copy, using Docker. Products with exactly one canonical downstream Mode declaration
receive a warning and successful exit without executing that fixture.
Inherited tests remain, but green CI does not prove the full new-module extension
path on product code. Add your own PostgreSQL access tests for product modules;
cover roles, organizations, rows, DENY, fields and API keys as described in the
[capability guide](../auth/capability-catalogue.md#extend-a-downstream-product).
`pnpm test:extension-contracts` proves copied notification/AI registration and upgrades
and still requires Docker in products. These commands remain independent CI groups. Adding an ordinary API file
only includes it in API discovery; it does not add it to an explicitly selected
extension fixture. Update the relevant fixture's selected list and its guards when
new extension conformance is required. Keep source-copy preparation, CLI/PATH behavior,
expected consumers, natural command exit and teardown.
See [background contracts](../backend/background-work.md#verify-a-registration) and
[channel conformance](../notifications/channels.md#run-the-conformance-lane).

## Build, CI and tooling contracts

Add appropriate Node tests under `scripts/lib/*.test.mjs` (or `scripts/*.test.mjs` for a
command's own entry point). The CI job **Script contracts** and `pnpm test:scripts` run both
patterns; use `node --test scripts/lib/<name>.test.mjs` for a focused local contract.

## Compile fixtures and email tests

Check the actual compiler configuration before adding a compile fixture.
API/shared source type checks use `pnpm --filter api typecheck` and
`pnpm --filter shared typecheck`; distribution-type contracts use the
[shared build contract](../backend/shared-package-build.md). Put negative cases
in the appropriate compiler fixture and verify the expected diagnostic.
Email rendering uses `pnpm --filter api test:email`; see
[email documentation](../email/README.md). Do not assume the default unit command
or Test aggregate covers an explicit command unless the workflow invokes it.

## A new test family or CI job

An ordinary discovered test needs no change to Test's dependencies. A genuinely
new family requires a deliberate runner/group, preparation, inventory, docs and
aggregate update. Update guards to reject a missing group and review projection
behavior. Test accepts only its declared groups with successful results.
Keep full API E2E, script-contract, platform and browser obligations intact.
