# Upgrade the welcome-email policy

Use this procedure when upgrading an installation containing policy1 EMAIL work
to conservative policy2. Fresh installations use2 automatically.
The command changes only proven untouched jobs. It never sends mail.

## Prerequisites

Use the approved API image containing `dist/cli/welcome-upgrade.js` and the additive
migration `20261026000000_conservative_welcome` for recipe/cooldown fields. Retain your complete Compose selection and
private environment. Arrange a maintenance window and authorized DB/Redis access.
This procedure does not authorize a deployment or a business reissue.

1. Stop ingress/account actions, producers, schedulers, control mutators and workers
   that can touch EMAIL. Stop API and worker containers gracefully, allowing60 seconds:

   ```sh
   docker compose stop --timeout 60 api worker
   ```

2. Verify the deployment inventory contains no running old API/worker process or
   automatic restarter, including other hosts. Keep them stopped. Do not run old
   and new workers together. A container stop does not cancel remote processing.
3. Pull approved images and run only its migration step from the
   [canonical rollout](../operations/single-host-compose.md):

   ```sh
   docker compose run --rm --no-deps migrate
   ```

   Require successful completion. Keep API/worker stopped.
   Recheck the inventory before converting jobs.

4. Pause EMAIL with the new image while every mutator remains stopped:

   ```sh
   docker compose run --rm --no-deps api node dist/cli/welcome-upgrade.js \
     --queue-state paused --mutators-stopped
   ```

   Require `queueState: paused`. The helper refuses unpaused or active work.
   A pause alone does not prove that workers stopped.

Keep the maintenance state until every retained job has a recorded decision.
Do not drain the queue by sending messages.

## Inventory and convert

Run each command in the new API image, without starting its dependencies:

```sh
docker compose run --rm --no-deps api node dist/cli/welcome-upgrade.js \
  --inventory --mutators-stopped
```

The JSON contains broker job IDs, `nextBrokerCursor`, PG evidence and
`nextEvidenceCursor`. Save this bounded metadata privately. No bodies or credentials
are printed. Follow each nonterminal cursor until both inventories finish:

```sh
docker compose run --rm --no-deps api node dist/cli/welcome-upgrade.js \
  --inventory --mutators-stopped --cursor '<nextBrokerCursor>' \
  --after '<nextEvidenceCursor>'
```

When the broker cursor reaches0, add `--skip-broker` on remaining PG pages.
When the PG cursor is null, omit `--after` and add `--skip-evidence` on remaining
broker pages. Stop when both finish. Duplicate broker IDs are harmless. Record PG-only evidence even when its
broker job has expired. The flag attests your verified maintenance state; it does
not discover or stop other processes.

For each broker ID, inspect its classification before applying conversion:

```sh
docker compose run --rm --no-deps api node dist/cli/welcome-upgrade.js \
  --id '<job-id>' --mutators-stopped
```

| Result                     | Required action                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `eligible`                 | Untouched policy1 job: zero starts, no evidence, body, grant or history ambiguity. May convert. |
| `converted` / `already_v2` | Record the result. Repeating the original command does not reset identity or attempts.          |
| `protected`                | Retain original evidence. Accepted suppresses sending; unknown remains blocked. No conversion.  |
| `blocked` / `unconfirmed`  | Keep maintenance active. Investigate the safe reason; never force metadata to fit.              |

Convert only an eligible job:

```sh
docker compose run --rm --no-deps api node dist/cli/welcome-upgrade.js \
  --id '<job-id>' --apply --mutators-stopped
```

Save each ID/result and conversion identity/version in your private manifest.
After an interruption, classify the same IDs again. A failed or ambiguous command
is not a completed conversion. Started policy1 work with only `none` results still
requires a separate decision; this helper does not reinterpret its old timing proof.

## Resume or stop

Verify every item is version2 or explicitly retained and blocked/protected.
The new consumer refuses remaining policy1 execution. Do not reset firstDispatchAt,
key, body, manual grant or unknown counts. Preserve PG uncertainty after broker TTL.

Resume the queue while mutators remain stopped:

```sh
docker compose run --rm --no-deps api node dist/cli/welcome-upgrade.js \
  --queue-state running --mutators-stopped
```

Require `queueState: running`. Start only the new API/workers through the canonical
rollout. Verify readiness and welcome diagnostics before reopening ingress.
Apply the [delivery scenario](delivery.md#verify-delivery-on-a-deployed-stack) only
under a separate approved recipient/send budget.

Rollback requires stopping all version2 mutators first. Do not restart a policy1
replay executor against converted or protected records. Restore/reconciliation
requires a separate reviewed recovery operation and permission. Keep maintenance
active when the inventory or outcome cannot be confirmed.
