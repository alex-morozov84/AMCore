# Persistent Audit Log

AMCore persists a durable audit trail for privileged actions in
`core.audit_log`.

This is an application-level semantic audit log. It records "who did what" at
service boundaries such as admin role changes, invite flows, API key changes,
and privileged session step-up.

## Captured Actions

Actions are a **closed, code-owned taxonomy**. Every action is a dotted
`area.event` string in the `AUDIT_ACTIONS` tuple, which is the single source of
truth and the `AuditAction` type — the recorder only accepts values from it:

- source: [`core/audit/audit-log.actions.ts`](../../apps/api/src/core/audit/audit-log.actions.ts)
- per-action metadata allowlist: [`core/audit/audit-log.metadata.ts`](../../apps/api/src/core/audit/audit-log.metadata.ts)

The current areas are `admin.*` (privileged maintenance and user administration),
`auth.*` (session step-up), `api_key.*`, `org.*` (invite lifecycle), `ai.*`
(approval, tool, assistant-registry, and conversation-control events), and
`telegram.*` (connection linking). Read the source file for the exact set rather
than relying on a list here — see [Add an audited action](#add-an-audited-action)
to extend it.

The originating runtime Pino event name is preserved separately as
`metadata.pinoEvent`.

## Row Shape

Each row stores:

- `id`, `createdAt`
- `actorType`, `actorId`
- `action`
- `targetType`, `targetId`
- `organizationId`
- `requestId`, `ip`
- `category`
- `metadata`

Important data-model choices:

- `actorId`, `targetId`, and `organizationId` have no foreign keys.
- This is intentional so the audit trail survives hard-delete flows (a deleted
  user or org must not cascade away its audit history).
- `metadata` is allowlist-driven per action, not arbitrary caller JSON.
- AI tool/approval targets use `AI_TOOL_INVOCATION` and `AI_APPROVAL`.

## Sensitive Data Rules

Audit rows must not contain:

- raw email addresses
- passwords
- reset or invite tokens
- API key secrets, hashes, or salts
- prompt text, provider bodies, tool arguments, tool results, or approval reason
  text
- other credential material

Recipient identifiers use `emailHash` when email identity is needed.

AI tool/approval metadata is content-free and limited to bounded identifiers or
codes such as `toolId`, `riskClass`, `invocationId`, `approvalId`, `runId`,
`decision`, `reasonCode`, and `outcome`.

## Write Modes

AMCore writes audit rows one of three ways:

- **In-transaction** (`{ tx }`) for privileged DB mutations. If the audit insert
  fails, the main mutation rolls back too.
- **Best-effort** (the non-transactional default) for post-commit or side-effect
  events. If the audit insert fails, the completed action still succeeds and the
  failure is logged.
- **Strict fail-closed** (`{ failOpen: false }`, non-transactional) when the row
  must be durable _before_ the caller proceeds — privileged-read accountability,
  where a failed write propagates so the caller aborts rather than serving the
  resource un-audited.

Current examples:

- In-transaction: admin system-role change, invite create/accept, API key
  create/revoke, AI approval lifecycle events (`ai.approval.requested`,
  `ai.approval.approved`, `ai.approval.rejected`, `ai.approval.expired`).
- Best-effort: admin cleanup, admin session revocation, step-up
  success/failure, invite revoke, AI tool execution events (`ai.tool.invoked`,
  `ai.tool.execution_failed`).

## Add an audited action

Recording a new privileged action is three steps plus a write-mode choice.

**1. Add the action** to `AUDIT_ACTIONS` in
[`audit-log.actions.ts`](../../apps/api/src/core/audit/audit-log.actions.ts) as a
dotted `area.event` string. It joins the closed `AuditAction` union, so every
call site is type-checked against it.

**2. Declare its metadata allowlist** in the `specs` map in
[`audit-log.metadata.ts`](../../apps/api/src/core/audit/audit-log.metadata.ts).
Metadata is **allowlist-driven, not arbitrary caller JSON** — any field not in
the spec is dropped before the row is written. Each field is one of: `true`
(pass a primitive through), `'string[]'` / `'number[]'`, a nested spec, or a
**bounded-value function** (e.g. the `boundedString(maxLength, pattern)` builder in
that file) that accepts only in-grammar values and drops the rest. Keep every
field **bounded and content-free** — a coded id, count, or classification, never
free text, and never anything from [Sensitive Data Rules](#sensitive-data-rules).
`emailHash` and `pinoEvent` are allowed for every action by the common metadata
spec, so add them at the call site only when that action actually has those
bounded values.

```ts
// in specs — reuse a bounded builder for id/code shapes, `true` for a plain primitive:
const code = boundedString(64, /^[a-z][a-z0-9_]*$/)
'billing.refund_issued': { invoiceId: true, amountCents: true, reasonCode: code },
```

**3. Record it** by injecting `AuditLogService` and calling `record(entry, opts)`.
`actorId`, `ip`, and `requestId` are resolved from the request context (CLS) when
omitted. `actorType` and `targetType` are the `AuditActorType` / `AuditTargetType`
Prisma enums — if your target isn't an existing value (`USER`, `ORGANIZATION`,
`API_KEY`, …), extend the enum in a migration first. `category` defaults to
`SECURITY`; set `AuditCategory.BUSINESS` for non-security events:

```ts
await this.audit.record(
  {
    action: 'billing.refund_issued',
    actorType: AuditActorType.USER,
    targetType: AuditTargetType.ORGANIZATION,
    targetId: org.id,
    organizationId: org.id,
    category: AuditCategory.BUSINESS,
    metadata: { invoiceId: invoice.id, amountCents: refund.amount, reasonCode: 'duplicate' },
  },
  { tx } // ← write mode; see below
)
```

**Choose the write mode** to match the action's durability need
([Write Modes](#write-modes)):

- **`{ tx }`** — in-transaction: the audit row commits atomically with the
  mutation, and a failed insert rolls the mutation back. Use for privileged state
  changes that must not exist un-audited.
- **default (`{}`)** — best-effort: a failed insert is logged and the completed
  action still succeeds. Use for post-commit or side-effect events.
- **`{ failOpen: false }`** — strict, non-transactional: the row must be durable
  **before** the caller proceeds and a failure propagates so the caller fails
  closed. Use for privileged-read accountability (serve the resource only after
  the access is recorded).

The metadata sanitizer and per-action specs are covered by the audit unit specs
alongside the module — extend those when you add an action so the allowlist stays
proven, not just declared.

## Append-Only Enforcement

`core.audit_log` is append-only at the database level.

AMCore enforces this with Postgres triggers that reject:

- `UPDATE`
- `DELETE`
- `TRUNCATE`

Why trigger-based:

- the current app DB role is effectively powerful enough that `REVOKE` alone is
  not a strong boundary;
- the trigger blocks ordinary mutations even for the owner role;
- the migration is shadow-database safe with Prisma.

Residual caveat:

- a sufficiently privileged owner or superuser can still bypass append-only via
  DDL such as disabling or dropping the trigger.
- External WORM storage is out of scope for the current audit-log baseline.

## Retention And Export

There is currently no automatic retention job or export pipeline for
`core.audit_log`.

Current policy:

- audit rows are intended to be durable records;
- hard-delete flows must not delete audit rows indirectly;
- retention automation and external export are future work.

## Read Access

AMCore does not ship an admin read endpoint yet.

When a read endpoint is added later, access to the audit log must itself be
audited.
