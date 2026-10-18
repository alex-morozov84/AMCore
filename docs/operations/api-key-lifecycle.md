# API key lifecycle operations

Revocation retains safe metadata and destroys both verifier columns. This changes
the schema and the behavior of API and cleanup processes together.
See [API keys](../auth/api-keys.md) for credential semantics.
See [Console API keys](../operations-console/api-keys.md) for operator controls.

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

## More than 1000 keys or oversized metadata

Member-key all/remove operations refuse more than 1000 unrevoked target keys.
At 1001 no key or membership changes. This is not an issuance cap: reducing the
set while the member keeps creating keys cannot guarantee offboarding. Large
metadata can also prevent normal inventory from returning IDs. The recovery below
uses read-only IDs and existing audited writers, not direct SQL changes or a new CLI.

Required operators have deployment control, trusted primary DB READ access and visibility of application sessions, a current
SUPER_ADMIN for platform revoke, and a trusted org administrator for final member
DELETE. They can be the same person; no cooperation from the departing user is
required. A previously valid original-bound live SUPER_ADMIN JWT can use the
existing DELETE bypass instead; never fabricate a credential.
Here original-bound means the authenticated JWT already carries this organization ID;
the SUPER_ADMIN claim at issuance and the current primary system role must both qualify.

1. Close ingress in maintenance and suspend automatic restart/scaling controllers.
   Drain and stop every normal API replica, native API process, web/BFF and custom
   key/membership writer. For the single-host Compose reference, stop
   `docker compose stop web worker api`; stop optional bundled Caddy with
   `docker compose --profile edge stop caddy`. Close external nginx/ingress too.
   Verify stopped/drained writers; keep database and Redis running.
2. Refuse if the recovery name or port is already occupied. Start the matching
   existing API image only for the operator:

   ```sh
   docker compose run --no-deps -d --name amcore-key-recovery \
     -p 127.0.0.1:15002:5002 -e PROCESS_ROLE=web api
   ```

   Record container ID. HTTP role has no workers/cron. Verify that no untrusted
   local process or network peer can call it. Loopback alone is insufficient on a
   shared host; restrict network access or keep maintenance until isolation works.
   Other topologies need their own verified equivalent controls.

3. Use existing `psql` with trusted connection configuration and a READ ONLY
   transaction. Bind `org_id` and `user_id` as psql variables. Read only bounded IDs:

   ```sql
   BEGIN READ ONLY;
   SELECT id FROM core.api_keys
   WHERE "organizationId" = :'org_id' AND "userId" = :'user_id'
     AND "revokedAt" IS NULL ORDER BY id LIMIT 100;
   SELECT id FROM core.org_members
   WHERE "organizationId" = :'org_id' AND "userId" = :'user_id';
   COMMIT;
   ```

   Never select secret/verifier/scopes for this recovery. Put at most 100 distinct
   IDs in a protected file `{"ids":["<key-id>"]}`. Verify target org/user carefully.

4. Authenticate the platform operator through existing `/api/v1/auth/login` on
   `http://127.0.0.1:15002`. Store the returned access token as the bearer header
   in a 0600 curl config; keep password/tokens out of history and logs.
   If fresh authentication is required, send an authenticated
   `POST http://127.0.0.1:15002/api/v1/auth/step-up` with JSON
   `{"password":"<operator-password>"}` from a protected request file.
   Replace the bearer header in the protected config with the returned
   `accessToken` before the next platform request. Refreshing a token alone does
   not renew authentication freshness. If step-up cannot succeed, stop recovery
   and reauthenticate through a supported method; never bypass fresh-auth. Submit:

   ```sh
   curl --fail-with-body --config ./protected-auth.conf \
     -H 'Content-Type: application/json' --data-binary @./selected-ids.json \
     http://127.0.0.1:15002/api/v1/admin/api-keys/revoke
   ```

   Expect 200 actual counts and existing platform audit. 404 cleanup race requires
   rereading/reselecting IDs. 429 honors Retry-After. Unknown response requires
   the stopped-writer check below before any further mutation; one inventory read
   cannot prove the old request finished. Reauthenticate normally for expired
   credentials/fresh-auth. Do not bypass these guards or auto-retry writes.

5. Repeat explicit bounded batches until unrevoked count is<=1000, preferably0.
   Keep ordinary issuance blocked. With trusted org-admin credentials, invoke
   normal `DELETE /api/v1/organizations/<org-id>/members/<user-id>` on that private
   API and expect 204. Existing last-admin guard, revocation, audit, delete and ACL
   advancement share the commit. SQL must not delete OrgMember or modify keys.
6. Verify absent membership, zero unrevoked target keys and durable audits. Stop
   and remove only the recorded recovery container:
   `docker stop amcore-key-recovery`, then `docker rm amcore-key-recovery`.
   Delete protected temporary auth/request files. Restart matching original
   services; require their Compose healthchecks to pass and API
   `GET /api/v1/health/ready` to return 200. Verify old-key 401, then reopen ingress
   last. On failure, retain maintenance rather than report successful offboarding.

### Lost recovery response and completion checks

Keep ingress and all ordinary writers stopped. If a batch or final DELETE loses
its response, do not infer completion from a timeout or one unchanged count.
For direct-to-primary single-host Compose, stop the recorded recovery container
and verify that its process exited. In a new READ ONLY transaction on primary,
require this count to be zero before inspecting the result:

```sql
SELECT count(*) FROM pg_stat_activity
WHERE datname = current_database()
  AND application_name IN ('amcore-web', 'amcore-worker', 'amcore-all');
```

The query counts idle sessions too: no application session may remain. Together
with stopped processes, it establishes that their old transactions have finished.
If a pooler hides sessions, custom writers remain, or session visibility/isolation
is unproved, keep maintenance and stop recovery for deployment-specific DBA review.
Do not kill arbitrary DB sessions or restart normal writers to obtain a zero.

After that barrier, reread membership and unrevoked IDs from primary. Inspect
committed `core.audit_log` fields `action`, `actorId`, `targetId`, `organizationId`,
`requestId`, `createdAt` and `metadata`. Match key/removal rows by organization and
recorded key/user IDs. Platform summaries have null organization/target IDs:
match their actor and request/time instead; an organization-only filter misses them.
Each actual transition has `api_key.revoked`; successful platform batches have
`admin.api_keys.revocation_requested`; removal has `organization.member_removed`
with selected/revoked counts. Existing revoked rows
keep their first actor/time/reason. Missing required audit is a recovery failure.
This checks current offboarding state, not an exact receipt for a lost request.
If more work remains, restart only the same isolated recovery container, recheck
its isolation and authenticate before a newly selected, explicitly confirmed
batch or DELETE. Keep ordinary issuance stopped throughout.

New reasons use an ordinary schema migration before matching app startup:
`organization_admin_revoked` and `membership_removed`, alongside existing owner and
platform reasons. All four preserve first-transition time/actor. No historical-data
transfer or dedicated recovery binary is required.

For a stale-confirmation-safe final DELETE, supply `?expectedMemberId=<membership-id>` from the
current membership read. A mismatch refuses before key/audit/membership effects. Legacy omission still
removes the current membership. The [product removal guide](../product-admin/organization-members.md#remove-a-member)
explains ready UI, actual error codes and unknown-result inspection. The precondition does not replace
the maintenance/quiescence requirements above or create an idempotent operation receipt.
