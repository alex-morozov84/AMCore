---
name: amcore-mfa-operations
description: Plan or perform authorized AMCore MFA protocol activation, MFA encryption-key maintenance or trusted account recovery. Excludes login UI development, ordinary user enrollment and whole-database recovery.
---

# AMCore operational MFA

Read `PROJECT_CONTEXT.md`, applicable product rules and the current
[MFA deployment/maintenance owner](../../../docs/auth/mfa-deployment.md).
Use [MFA foundation](../../../docs/auth/mfa-foundation.md) for protocol semantics.
This action is distinct from login UI development, ordinary user enrollment and
restoring the whole database. A system administrator role alone is not every
kind of deployment or trusted-recovery authority.

## Choose one operational branch

- Activation: establish complete actual fleet/artifact/environment evidence,
  database authority, matching keys/backups and separately approved admission.
  A maintenance or preflight success is not activation approval.
- Key maintenance: preserve the current key IDs/read keys, actual writer fleet,
  factor/draft references and retained backup requirements. A completed factor
  pass is not proof of every serving process or a successful backup restore.
- Trusted account recovery: establish the current account/protocol/owner conditions
  and private-terminal requirements before any reset or secret result.

Read the chosen current section before acting, including unknown-result and
repair limits. Do not copy its CLI, keys/defaults or protocol state machine here.

## Preserve the non-obvious boundaries

1. Distinguish image/source declarations from evidence collected from the actual
   serving instances. Local protocol status does not attest the whole fleet.
2. Use the approved administrative environment and current owner procedure.
   Runtime table permissions, an ordinary app session and application role are
   not substitutes for deployment database authority.
3. Preserve one-way activation and current compatibility floors. Never change a
   marker back to prepared, add a password-only operator fallback or reopen ingress
   on uncertain keys, fleet or command outcome.
4. Treat trusted reset as a security mutation with its own confirmation and
   session/continuation consequences. A ticket is not a published ordinary session.
   The recipient follows the restricted [browser recovery journey](../../../docs/auth/mfa-browser.md).
5. Keep secrets and recovery tickets off command arguments, reports and logs.
   The actual secret-bearing operation needs the owner's private unrecorded
   terminal procedure; do not perform it through an observation transcript.

Read [backup](../../../docs/operations/backup-restore.md) or
[rotation](../../../docs/operations/secret-rotation.md) prerequisites directly when
needed. Do not invoke generic rotation back after it handed over a keyring task.
Reading prerequisites grants no additional action authority.

Report the chosen branch, evidence/authority that exists versus is missing,
permitted actions, checks actually run and exact limits. If the task is planning,
produce a plan without activation, key changes, reset or ticket generation.
A successful plan/preflight cannot stand in for a performed and verified operation.
