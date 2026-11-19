---
name: amcore-secret-rotation
description: Plan or perform authorized AMCore credential replacement or compromise response. Select actual consumers and overlap. Excludes image rotation, MFA activation and automatic global revoke or logout.
---

# AMCore credential replacement

Read `PROJECT_CONTEXT.md`, applicable product rules and the current
[secret-rotation guide](../../../docs/operations/secret-rotation.md).
Use the [production profile](../../../docs/operations/production-deploy-profile.md)
to retain the installation's actual inputs and consumers.

## Classify before choosing a procedure

Identify the credential class, affected consumers, planned replacement versus
compromise, actual overlap support and task authority. Do not apply a generic
blue-green key recipe to every credential. Rotating an image is not credential work.

1. Inventory every relevant API, worker, web/BFF, operator and external consumer.
   Read the selected class section before deciding what old credentials still do.
2. Distinguish active connections, newly authenticated connections, issued access
   tokens, refresh credentials and opaque browser sessions. They need not depend
   on the changed secret in the same way. Do not promise global logout, immediate
   disconnection, transparent refresh or rollback unless the current owner proves it.
3. Choose the safe distribution/switch/reconnect order and actual checks. A restart
   is not necessarily an environment reload, and a mixed fleet can retain incompatible
   authority. Preserve the deployment's complete profile and separate credentials.
4. For compromise, reassess planned overlap/retention and containment with the owner.
   Availability may require a controlled outage. Do not automatically retain a
   compromised key or perform unapproved global revocation/destructive SQL.
5. Preserve unknown results, backup/key requirements and the actual remaining
   consumers. State a safe stop when the current inventory or supported transition
   is unconfirmed; do not repeat a credential mutation blindly.

## Database credential exposure in query statistics

If statement tracking may have recorded a database credential, follow
[statistics exposure recovery](../../../docs/operations/pg-stat-statements-recovery.md).
Separate containment, credential replacement and statistics cleanup. Use
change records to identify affected roles without printing statement text.
Keep observer access separate from reset authority. For a slow query without
suspected exposure, use the [database runbook](../../../docs/operations/runbooks/db.md)
and its triage guide.

## Delegate the MFA-specific decision once

MFA encryption keyring maintenance uses
[MFA key maintenance](../../../docs/auth/mfa-deployment.md#rotate-encryption-keys)
and mfa-operations when available. It is not JWT signing-key replacement or MFA
activation. Hand that part to the profile owner; do not invoke both complete
workflows in a cycle. Read shared prerequisites directly from current guides.

Report the credential by safe reference, class/consumers, permitted sequence,
actual checks, unknown outcomes and recovery/compromise limits. Never include
secret values in arguments, history, logs or reports. A suggested command or a
skill selection is not execution permission or proof that replacement succeeded.
