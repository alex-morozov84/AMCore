# AI tools and owner approval

A model can request only a code-registered tool in the bound assistant's
`toolAllowlist`. The worker validates input, prepares and persists one immutable
action, then executes that action under the conversation owner's current rights.
The starter's `current_time` tool is SAFE/read-only and is not allowlisted by
default. It has no privileged domain target.

## Register a tool

Keep the contract and headless authority separate from the worker executor.
Use the shipped
[`current-time.contract.ts`](../../apps/api/src/infrastructure/ai/tools/reference/current-time.contract.ts)
and [`current-time.tool.ts`](../../apps/api/src/infrastructure/ai/tools/reference/current-time.tool.ts)
as the complete reference for a SAFE tool without domain access.

A contract declares a stable lowercase `toolId`, positive `contractVersion`,
display metadata, risk class, idempotency class, input `parameters`, stored
`normalizedSchema`, and an authority module/token. The executor supplies:

```ts
prepare(input, context, tx): Promise<{
  args: NormalizedArguments
  target: { kind: string; id: string; revision: number } | null
  preview: Partial<Record<SupportedLocale, AiApprovalPreview>> | null
}>
execute(intent, context): Promise<{ output: string }>
```

Register its contract, exported executor token and `worker(core)` factory in
[`AI_TOOL_REGISTRATIONS`](../../apps/api/src/infrastructure/ai/tools/ai-tool-composition.ts).
The composition constructs `ConfiguredAiToolContractsModule.register(entries)`
once. `AiToolContractsModule` imports/re-exports that configured core; authority
modules export their own tokens and required reader dependencies.
`AiToolsWorkerModule.register(core, entries)` imports the same facade and worker
modules, derives executor providers and validates their IDs, versions, risk,
idempotency and schema hashes against the core contracts. Each worker factory
imports the facade and exports its executor token. `AiToolsModule` re-exports
the configured worker and core. Web consumers import only `AiToolContractsModule`.

The web DI graph contains schemas, metadata and headless authorities, with no
`prepare`/`execute` provider or tool transport. Composition can still statically
import worker JavaScript. Add the ID to a published assistant version's allowlist
to make it callable. Registration alone does not authorize model execution.

## Input normalization and stored validation

The loop parses model input with `parameters`; it may normalize strings, defaults
or indirect input. `prepare()` resolves the exact target/revision and significant
arguments using the supplied transaction. It performs no business mutation or
network I/O. It returns the final normalized `args` and, for a gated action, a
code-owned preview in every supported locale.

`normalizedSchema` validates durable arguments without changing them. Do not put
transforms in it; a resumed value must parse to itself. The persisted envelope
binds tool semantic version, both schema hashes, risk/idempotency, run,
conversation, invocation, originating provider call, owner, organization,
normalized arguments, target/revision and preview. A private hash of the original
normalized provider input identifies a repeated origin without rerunning
`prepare()`; that input hash is separate from the resolved effect arguments. The worker executes this
stored, detached, deeply frozen envelope, never freshly resolved arguments or a
new preview.

Bump `contractVersion` when authorization, target meaning, preview semantics or
execution effects change, even if the JSON schemas remain identical. JSON schema
hashes cannot capture arbitrary function semantics. Only one executable version
per tool ID is registered. Incompatible unstarted actions refuse execution; a
new handler or same-shaped schema does not authorize replacing the original
intent. Unknown effects take precedence over these compatibility failures.

The complete strict JSON envelope is limited to 32 KiB UTF-8 and depth 20;
preview data is limited to 8 KiB. Preview strings are bounded plain text, without
HTML/control characters or HTTP links, and describe at most ten effects. The
preview target ID must match the immutable target. Never store a credential,
signed URL, prompt or secret in arguments or preview.

## Current domain authorization

An authority implements `canDisclose(tx, intent)` and
`authorize(tx, intent, phase)` for preparation, owner approval and execution.
Import the domain's headless reader/authorization module, not its HTTP/JWT module.
For existing core RBAC, `DomainAuthorizationModule` exports the transaction-aware
`DomainAuthorizationService`: it reads primary owner membership/permissions and
uses the existing CASL normalization, field constraints and DENY rules. It does
not synthesize a SUPER_ADMIN grant for the run owner.

Preparation checks the intended operation. Approval checks current target read
and execute rights. Execution checks current rights and the assistant's current
allowlist again. These admission checks do not replace the domain mutation's own
atomic authorization and revision check.

The domain service performing the effect must, in one transaction:

1. Acquire the existing user, organization/ACL and target locks in the same order
   as membership/revocation and domain writers.
2. Read current membership, scoped grants, field permissions and DENY rules.
3. Verify the frozen target identity/revision and permitted fields.
4. Apply its existing idempotency/effect identity and mutation atomically.

A stale revision or revoked right refuses before mutation. Do not resolve a
replacement target or silently update the preview. An external request cannot be
recalled after admission; pass current credentials, the stable key and abort
signal without persisting them. A race after external admission remains an
explicit residual risk, not an atomic database guarantee.

## Owner approval API

`SENSITIVE` and `DESTRUCTIVE` tools require a target and meaningful immutable
preview. `SAFE` tools run automatically but still require current domain rights.
Only the conversation owner can decide. SUPER_ADMIN/operator access to a
conversation does not let that operator approve somebody else's action. API keys
cannot use this personal bearer surface.

Read `GET /ai/approvals?status=pending` first. Each response includes
`toolVersion`, `intentHash`, `preview` and `disclosure`. A current read denial
returns `preview: null`, `disclosure: "unavailable"`; retained legacy approvals
have `disclosure: "legacy"`. Stored preview evidence is preserved. Responses are
`private, no-store` and never expose raw arguments or the private envelope.

Submit the exact hash returned for the displayed action:

```bash
curl -X POST /ai/approvals/<approval-id>/decision \
  -H 'Authorization: Bearer <owner-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"decision":"approve","intentHash":"<displayed-intent-hash>"}'
```

`reject` also requires that hash; a bounded optional `reason` is supported. Missing
hash or extra request fields return 400. A foreign/missing approval returns 404.
A mismatched hash, incompatible action, expiry or opposite prior decision returns 409. First approval without current read/execute rights returns 403. The same
decision with the same hash returns 200 without another effect, and its response
is freshly redacted according to current disclosure rights. Rejection remains
available after domain read rights are revoked.

The decision transaction uses fresh PostgreSQL time after lock waits and again
after authorization. Approval cannot outlive `AI_APPROVAL_TTL_MS` or the run
deadline. Rejecting resumes the loop with a fixed rejection notice without
executing the tool. Cancellation/takeover voids a pending approval and does not
resurrect an approved action that has not started. OpenAPI `/docs` contains the
strict request, response and error contracts.

## Replay, effects and uncertain outcomes

One originating provider call produces one durable invocation. Its
`context.idempotencyKey` is `ai-tool:<invocationId>` throughout its lifetime.
A crash, timeout, deployment or approval resume does not create a replacement
action or key. The host applies a recorded result to the transcript once.

| Execution outcome                                     | Durable behavior                                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `execute` returns                                     | Record success and apply its result once when the run can continue.                                                         |
| `AiToolRejectedError`                                 | Author proves no effect; fail `tool_execution_failed`.                                                                      |
| `AiToolRetryableError`                                | Author proves no effect; record `tool_retryable_no_effect` and fail. The host does not automatically retry the side effect. |
| Other side-effect error, timeout, crash or lost lease | Record `outcome_unknown`; stop with `tool_effect_unknown`.                                                                  |
| Read-only failure                                     | Ordinary failure; abandoned read-only work is adopted only if the contract, current rights and allowlist still match.       |

Throw a no-effect error only when nothing happened with certainty. A connection
reset after acceptance and an aborted request do not prove that. Pass the stable
key to the domain/provider's real deduplication mechanism and honor
`context.signal`. The author owns effect idempotency and the provider's key
retention window; declaring `idempotent` is not proof of exactly-once execution.
`unsafe` tools are refused at registration.

An unknown or abandoned executing side effect stops recovery **before** checking
assistant enabled state, executable preflight, missing handlers, versions, schemas,
current rights or allowlists. It never
causes re-execution or another model call for a replacement action. Multiple
unresolved actions without uncertain-effect evidence and `SUCCEEDED` without `appliedAt` fail
`tool_state_inconsistent`; no result is fabricated and no automatic recovery is
added. Cancel/takeover/deadline during execution preserves success or uncertainty
while honoring the stop cause.

## Verify an extension

The executable registration seam is demonstrated by
[`tool-registration.ts`](../../apps/api/test/fixtures/extension-contracts/tool-registration.ts).
Its synthetic authority authorizes only isolated fixture targets; do not copy
that authority for a real domain. A domain conformance fixture must prove actual
primary permissions, revision/effect atomicity and revocation races. Keep tests
for immutable preview/hash, strict decisions, owner isolation, post-revoke
redaction, semantic/schema mismatch, allowlist removal and unknown-effect
precedence in addition to a successful execution.

Run `pnpm test:extension-contracts` with Docker to execute the registered fixtures
in an isolated public-source copy. `ai-tool-extension-contracts.e2e-spec.ts` proves
current domain permissions, deadline admission and mutation races;
`ai-run-legacy-and-locks.e2e-spec.ts` proves unknown precedence over incompatible
preflight and mixed pending origins. Both suites are part of the CI conformance lane.

## Configuration and maintenance

`AI_TOOL_LOOP_MAX_STEPS` bounds provider rounds;
`AI_TOOL_EXECUTION_TIMEOUT_MS` bounds a tool/hook wait;
`AI_APPROVAL_TTL_MS` bounds owner approval; `AI_RUN_DEADLINE_MS` bounds the entire
run, including approval waits. Cooperative cancellation does not free a physical
worker slot until the underlying call settles.

Use the [maintenance upgrade procedure](../operations/deployment.md) for legacy
hashless actions and prepared-request upgrades. Preserve terminal history and
human decisions; expire hashless pending approvals, fail incompatible unstarted
work, and retain unknown-effect evidence. Never synthesize an approval hash,
assume an attempted row never ran because it is queued again, or clear uncertainty
by generating a fresh invocation.
