---
name: amcore-recovery
description: Plan or perform an authorized AMCore backup, data restore or recovery-plan review. Excludes generic incident diagnosis, provider PITR implementation and recovery of one MFA account.
---

# AMCore backup and data recovery

Read `PROJECT_CONTEXT.md`, local product instructions and the current
[backup/restore guide](../../../docs/operations/backup-restore.md).
For the reference topology also read the applicable
[single-host recovery sequence](../../../docs/operations/single-host-compose.md).
Provider PITR implementation and generic incident triage are not supplied here.

## Select the recovery boundary

Name the intended source/recovery point, exact target, permitted actions and loss
window. Distinguish taking a backup, rehearsing a restore and admitting an actual
restored deployment. A plan is not permission to stop writers or overwrite data.

1. Select matching database, files, keys, image/protocol policy and source
   expectations under the owning procedure. A completed dump, counts alone or an
   arbitrary latest archive does not certify the complete recovery set.
2. Establish the stopped-writer boundary and keep it through capture/reconciliation
   or restore until the owner permits admission. A live file archive is not made
   consistent by its timestamp. Preserve the complete deployment profile.
3. Verify intended target and native database authority before destructive steps.
   Partial imports can leave objects behind; do not turn unknown state into a
   successful clean restore or use an implicit reset against retained data.
4. Reconcile file references, keys, migration history, expected values and affected
   credentials/sessions/Redis state according to current owners. Read
   [API-key lifecycle](../../../docs/operations/api-key-lifecycle.md) when applicable.
5. Prove the actual application's restored-target access and safe consumer admission
   required by the procedure. A different disposable test copy, successful import
   or old canary does not automatically certify this target.

## Preserve authority and limits

For MFA-encrypted records/backups, read the current
[MFA deployment prerequisites](../../../docs/auth/mfa-deployment.md).
Restoring the data system is different from trusted recovery of one account.
A lost MFA app belongs to mfa-operations/current account-recovery owner, not a full
DB restore. Do not invoke activation or credential rotation merely from a link.

Stop affected destructive/admission work on unknown artifacts, target, result,
keys or rollback. Preserve the current evidence; never overwrite the only good
copy or invent lost expectations. Report verified versus missing data, loss and
rollback boundaries, actions actually performed and the next safe step.
No production restore, external/provider action or new command is authorized by
this skill alone. Plan-only observations do not prove an executed recovery.
