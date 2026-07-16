# Persistent Audit Log

AMCore persists a durable audit trail for privileged actions in
`core.audit_log`.

This is an application-level semantic audit log. It records "who did what" at
service boundaries such as admin role changes, invite flows, API key changes,
and privileged session step-up.

## Captured Actions

Current action taxonomy:

- `admin.cleanup.executed`
- `admin.user.sessions_revoked`
- `admin.user.system_role_changed`
- `api_key.created`
- `api_key.revoked`
- `auth.step_up_failed`
- `auth.step_up_succeeded`
- `ai.approval.approved`
- `ai.approval.expired`
- `ai.approval.rejected`
- `ai.approval.requested`
- `ai.tool.execution_failed`
- `ai.tool.invoked`
- `org.invite_accepted`
- `org.invite_created`
- `org.invite_revoked`

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
- This is intentional so the audit trail survives hard-delete flows covered by
  ADR-030.
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

AMCore uses two write modes:

- In-transaction for privileged DB mutations. If the audit insert fails, the
  main mutation rolls back too.
- Best-effort for post-commit or side-effect events. If the audit insert fails,
  the completed action still succeeds and the failure is logged.

Current examples:

- In-transaction: admin system-role change, invite create/accept, API key
  create/revoke, AI approval lifecycle events (`ai.approval.requested`,
  `ai.approval.approved`, `ai.approval.rejected`, `ai.approval.expired`).
- Best-effort: admin cleanup, admin session revocation, step-up
  success/failure, invite revoke, AI tool execution events (`ai.tool.invoked`,
  `ai.tool.execution_failed`).

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
