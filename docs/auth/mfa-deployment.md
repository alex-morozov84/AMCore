# Deploy and activate operator MFA

Use this procedure only after the owner approves activation separately.
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
Keep keys needed by retained factors, drafts and backups. Configure the confidential
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
For recovery and key rotation, follow the
[account MFA reference](mfa-foundation.md#internal-offline-recovery-boundary).
