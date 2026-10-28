# Deploy and maintain operator MFA

Obtain separate owner approval before activation. Maintenance does not grant it.
A successful build, review or preflight does not approve activation.
The protocol changes once, from `prepared` to `active`. There is no off switch.

## Before maintenance

Use reviewed API, worker and web images from the same source commit. Pin every
image by digest. Keep an inventory of every serving replica. Do not mix old
password-only binaries with MFA-capable binaries during activation.

Back up the database and its matching encryption keyring separately. Retain the
minimum compatible image/protocol policy with the backup. Complete the normal
[deployment prerequisites](../operations/deployment.md), including a verified
restore and a deployment-owner database connection for the administrative CLI.
Runtime table DML permissions alone do not authorize activation or recovery.

Add `docker/compose/mfa.yml` to the saved complete `COMPOSE_FILE`. Configure
`MFA_ACTIVE_KEY_ID` and `MFA_ENCRYPTION_KEYS` on every API and worker.
Keep keys needed by retained factors, drafts and database backup copies. Configure the confidential
browser-context transport on API/web as described in
[placement and sessions](../product-admin/placement-and-sessions.md).
Never put key values, recovery tickets or database passwords in command arguments.

The final binary allows ordinary users while the protocol is `prepared`, but
refuses operator grants. Operators cannot use password-only access during this
maintenance boundary. Initial setup becomes available after activation.

## Check the exact images

Build with `BUILD_SOURCE_COMMIT` set to the reviewed full Git commit. The normal
API/web build writes `mfa-artifact.json`. API/worker images contain it at
`/app/dist/mfa-artifact.json`; the web image contains it at
`/app/apps/web/mfa-artifact.json`. A local build without a pinned commit writes
`sourceCommit: null`; deployment preflight refuses that artifact.

Collect the artifact from **each actual serving instance**, together with its
pinned image digest. For the reference Compose stack with one instance per role:

```bash
docker compose exec -T api cat /app/dist/mfa-artifact.json > api-artifact.json
docker compose exec -T worker cat /app/dist/mfa-artifact.json > worker-artifact.json
docker compose exec -T web cat /app/apps/web/mfa-artifact.json > web-artifact.json
```

For scaled services, collect every replica separately. Make `mfa-fleet.json` with
this shape. Replace placeholders with actual instance names, image digests and
complete artifact objects read above; add an entry for every additional replica.

```json
{
  "instances": [
    {
      "instance": "api-1",
      "role": "api",
      "image": "<api-image>@sha256:<digest>",
      "artifact": "<actual API artifact object>"
    },
    {
      "instance": "worker-1",
      "role": "worker",
      "image": "<worker-image>@sha256:<digest>",
      "artifact": "<actual worker artifact object>"
    },
    {
      "instance": "web-1",
      "role": "web",
      "image": "<web-image>@sha256:<digest>",
      "artifact": "<actual web artifact object>"
    }
  ]
}
```

`artifact` must be a JSON object, not the placeholder string. Keep the file below
64 KiB. An API process using `PROCESS_ROLE=all` can use role `all` instead of
separate API/worker entries. Preflight checks API, worker and web coverage, unique instance names, pinned images,
matching source commits, protocol compatibility and the compiled recovery command.
It also checks migrations, retained encryption-key references and database owner
authority. It does not inspect remote containers, discover omitted replicas,
prove an image digest or close ingress. The operator verifies those facts.

## Activate during closed ingress

1. Close authentication and privileged ingress. Drain in-flight authentication
   and privileged mutations. Keep ingress closed if any replica or outcome is unknown.
2. Upgrade the whole API/worker/web fleet to the checked images. Do not reopen
   authentication while a password-only replica remains.
3. Run the compiled administrative command from the approved API image, using
   its deployment-owner database connection and keyring. Mount `mfa-fleet.json`
   read-only as `/run/mfa/fleet.json`:

   ```bash
   node dist/cli/mfa-maintenance.js preflight --fleet-file /run/mfa/fleet.json
   ```

   Require `status: "preflight_passed"`. This command changes no protocol state.
   Source-mode `pnpm auth:mfa` cannot substitute for the checked compiled artifact.

4. After explicit activation approval, run in the same administrative context:

   ```bash
   node dist/cli/mfa-maintenance.js activate --fleet-file /run/mfa/fleet.json --ingress-drained --confirm 'ACTIVATE MFA V1'
   ```

   `--ingress-drained` records the operator's acknowledgement; it is not a probe.
   Activation and its mandatory audit record commit together. A repeated command
   returns `already_active` without issuing sessions or creating another audit record.

5. Restart API/workers and verify readiness with the configured current key.
   Keep all retained keys needed by existing encrypted records.
6. Through controlled ingress, verify one operator's password, app setup and
   code-saving journey. Verify an ordinary account and a protected backup-code
   login. Open public ingress only after these checks pass.

```text
Close and drain ingress -> upgrade every instance -> check artifacts and keys
  -> deployment-owner preflight -> approved activation + audit
  -> restart and canary checks -> reopen ingress
```

Preexisting operator tokens receive a refusal until the operator completes the
required login/setup. The minimal setup page does not require Console access.
An OAuth provider cannot replace the protected account's local password or
second-factor proof. Invitation membership still requires separate consent.

## Unknown results and repair

If a command returns `unconfirmed`, keep ingress closed. Inspect local protocol
state before repeating a mutation:

```bash
node dist/cli/mfa-maintenance.js status
```

`local_protocol` reports only database state/version. It does not prove fleet
health, complete deployment or accepted ingress. Repair missing images, migrations,
keys or owner authority, then repeat preflight. Never edit the protocol back to
`prepared` to bypass a refusal.

Before activation, rollback can use the previous compatible prepared deployment.
After activation, use forward repair or maintenance with compatible MFA binaries.
A database restore requires its matching keys and policy floor; validate an
operator canary and targeted offline recovery before reopening ingress.

## Postpone activation

A successful preflight does not permit activation when an old replica remains
reachable. Keep ingress closed, remove or update that replica, verify the complete
serving inventory and repeat preflight against the actual fleet.

If all replicas are updated but owner approval is absent, do not activate.
If maintenance has already closed ingress, keep it closed until the owner chooses
activation or a return to a compatible prepared deployment. Before reopening a
prepared deployment, confirm `status` still reports `prepared`, verify readiness
and ordinary-account access, and verify the final MFA-capable binaries refuse
operator grants. Do not edit the protocol marker or add password-only operator
fallback. After activation, only compatible active-state repair is permitted.

## Rotate encryption keys

Use the reviewed administrative API build with database access. Keep the old
key available throughout migration. Never reuse a key ID for different key bytes.

1. Add a new canonical base64-encoded 32-byte key under a new ID in
   `MFA_ENCRYPTION_KEYS`. Distribute the full retained keyring to every API/worker.
2. Set `MFA_ACTIVE_KEY_ID` to the new ID on every writer. Verify readiness and
   the actual serving inventory. Keep old read keys during mixed writer rollout.
3. From the administrative API image, run:

   ```bash
   node dist/cli/mfa-maintenance.js rotate-key
   ```

   Each batch examines at most 100 factors. Each account commits separately.
   Continue with `--after-user-id <nextUserId>` when that cursor is returned.

4. Resolve failed accounts, then repeat from the beginning to catch earlier
   failures and old-key writes. Require `complete` with `remaining: false`.
5. Run deployment preflight against the actual fleet. Retain old keys while
   factors or unbound drafts reference them. Keep matching keys separately with
   all retained database backup copies. Verify restore with those keys before
   retiring any retained copy's key material.

`more` requires another batch. `partial` exits 3 and retains failed factors.
`unconfirmed` exits 4; earlier transactions may have committed. Inspect references
and repeat safely. Invalid input or key configuration exits 2. Source checkouts
can use `pnpm --filter api auth:mfa -- rotate-key` for the same command.
The command reads database/keyring configuration without starting HTTP or Redis.
It never prints seeds, keys or connection strings.

Rotation preserves factor identity, replay counters, account security version,
backup codes and session proofs. `complete` proves only that the final query found
no old factor references. It proves neither fleet migration nor expired-draft
cleanup nor database restoration. An uncertain or incomplete fleet/key state
must not reopen closed ingress. Use the readiness and canary checks above.

## Recover an account without its app or codes

Recovery requires a private
POSIX terminal and an actual core-schema owner, owner-role member or superuser.
Runtime table DML and the application SUPER_ADMIN role are insufficient.
The target must already be MFA-protected and have a local password. Complete
normal verified password recovery before issuing a ticket if that password is absent.
The command requires the active supported protocol. The recipient finishes
recovery through the restricted browser/API setup journey. Recovery is not activation.

Before proceeding, confirm the target account and the irreversible session reset
with the deployment owner. Use the administrative database/keyring environment:

1. Open a private, unrecorded POSIX terminal. Do not pipe, redirect or capture it.
2. Run `node dist/cli/mfa-maintenance.js recover --user-id <account-id>` from the
   approved API build. Replace `<account-id>` with the exact account identifier.
   A source checkout can use `pnpm --filter api auth:mfa -- recover --user-id <account-id>`.
3. Enter the reason and exact `RESET <account-id>` confirmation when prompted.
4. Privately deliver the displayed ticket through the organization's approved
   channel. The recipient follows [browser recovery](mfa-browser.md#recover-without-your-app-or-backup-codes).

The reset transaction
revokes sessions and continuations, advances the account security version, removes
the old factor/codes and preserves required MFA with emergency enrollment pending.
It records strict audit and notification intent together. A missing old encryption
key does not prevent targeted reset; enrollment still needs a healthy active key.

The command displays one 15-minute enrollment ticket only on the verified private
terminal. JSON outcomes, logs, audit and notifications never contain that ticket.
The database stores only its domain-separated hash. Password reset or another
offline reset invalidates earlier tickets. A lost ticket needs another confirmed reset.
The terminal check verifies device identity, OS owner and read permissions; the
operator must also keep the terminal private and unrecorded.

Password plus ticket grants only a new setup continuation. It creates no ordinary
session. Ticket consumption is single-use and rotates the continuation; a lost
winning response cannot recover its secret through the old parent. The user must
then connect a new app, verify its TOTP and acknowledge the new backup codes.
The emergency flag clears only at binding; completed setup remains pending until
code saving. The browser then publishes the completed session.

A refused prerequisite changes nothing. A failed strict transaction rolls back its
security changes and intent. `unconfirmed` never promises rollback after an uncertain
commit. If the ticket cannot be displayed after commit, a new confirmed reset is
required. A fresh reset revokes sessions and invalidates earlier tickets again.
There is no support UI, HTTP reset endpoint, master code or global MFA-off
operation for this recovery path.
