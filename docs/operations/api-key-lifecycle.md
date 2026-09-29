# API key lifecycle operations

Revocation retains safe metadata and destroys both verifier columns. This changes
the schema and the behavior of API and cleanup processes together. See
[API keys](../auth/api-keys.md) for credential semantics and
[Console API keys](../operations-console/api-keys.md) for operator controls.

## Cutover

Mixed old/new API or worker versions are unsupported: old readers cannot process
null verifiers, old cleanup deletes history, and old revoke physically deletes rows.
Drain traffic and stop every old API/cron/worker process using this code. Take a
backup, apply `db:migrate:prod` as a one-shot deployment step, then start only the
matching new version. Prove create/auth/revoke/metadata/cleanup on that version
before reopening traffic. Never use `db:migrate` in production.

## Cleanup

`API_KEY_TERMINAL_RETENTION_DAYS` is a source constant of30, not an environment
setting. Nightly and manual cleanup delete rows when either expiry or revocation
is at least30 days old. A late revoke cannot extend an older expired row's storage.
No-expiry, unrevoked rows remain. The result/failure category is
`staleTerminalApiKeys`, replacing `expiredApiKeys`; consumers must update that
public cleanup field. Failed cleanup extends storage but does not restore access.
The cutoff defines eligibility; daily cadence or failures can delay deletion.
User/organization Cascade may delete rows earlier. Audit retention is independent.

## Emergency rollback after a revoke

Prefer a forward fix. Never start an old binary on retained nullable-verifier data.
If reverting the application is unavoidable, retain trusted audit evidence and a
backup, enter maintenance, and stop all application/cleanup writers. Have the DBA
review and execute this explicit reverse-schema procedure on the intended database:

```sql
BEGIN;
DELETE FROM core.api_keys WHERE "revokedAt" IS NOT NULL;
ALTER TABLE core.api_keys DROP CONSTRAINT api_keys_revocation_state_check;
ALTER TABLE core.api_keys ALTER COLUMN "keyHash" SET NOT NULL;
ALTER TABLE core.api_keys ALTER COLUMN salt SET NOT NULL;
DROP INDEX core."api_keys_revokedAt_idx";
DROP INDEX core."api_keys_createdAt_id_idx";
ALTER TABLE core.api_keys DROP COLUMN "revokedAt",
  DROP COLUMN "revokedByUserId", DROP COLUMN "revocationReason";
COMMIT;
```

This loses retained history, preserves irreversible invalidation through deletion,
and leaves unrevoked rows valid. Check constraint/index names against the deployed
migration before executing; abort on any mismatch. On the same stopped deployment,
retain the matching row from `_prisma_migrations` externally with the backup, then
remove only its successfully completed entry for
`20260928180000_api_key_retained_revocation`. Prisma `migrate resolve --rolled-back`
is for failed migrations and does not reverse a successful one. Do not rewrite
other migration records. With old source, `prisma migrate status` must show the
previous migration set applied, and database NOT NULL/schema must match old Prisma.

Rehearse this exact procedure on an isolated database after a real revoke: the
revoked token still returns401 on the old version, an unaffected token works, old
list/create work, and migration status agrees. Do not reopen production until those
checks pass. Redeploying the new version later requires its original migration
again; it cannot recreate purged history. There is no automatic down migration.

## Restore

A backup taken before revocation contains the old verifier and can revive a key.
Before reopening restored traffic, replay trusted post-backup revocations against
the restored database, or invalidate all restored API keys and reissue them. If
trusted replay is incomplete, use invalidation. Never infer revocation from missing
or expired Audit retention. There is no external monotonic revocation ledger.
A normal dump schema check cannot prove this credential-safety condition; include
it in your restore drill alongside the [backup/restore guide](backup-restore.md).
