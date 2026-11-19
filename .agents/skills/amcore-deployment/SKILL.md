---
name: amcore-deployment
description: Plan or perform an authorized AMCore product build, deployment, release upgrade, rollout, deployment observability change or a disposable capacity-measurement exercise. Excludes merging starter source, database recovery and operational MFA activation.
---

# AMCore deployment and rollout

Read `PROJECT_CONTEXT.md`, local product workflow and the current
[deployment guide](../../../docs/operations/deployment.md).
Use [single-host Compose](../../../docs/operations/single-host-compose.md) or the
[production deploy profile](../../../docs/operations/production-deploy-profile.md)
for the actual topology. Source integration belongs to fork-update, not deployment.

## Establish authority and evidence

Name the target environment, release, allowed actions and complete serving topology.
A requested plan permits planning, not building, deploying or changing credentials.
Use the local product's artifacts and guides, not another checkout's commands.

1. Bind the exact artifact identities and promotion evidence to the intended release.
   A tag, version string or successful build is not evidence that staging ran those
   bytes, nor that a template performed a real deployment.
2. Preserve the deployment's project, environment inputs and complete saved overlays.
   Identify actual API/worker/web replicas and any product consumers; do not guess
   a convenient subset or treat tracked configuration as live enforcement.
3. Read the [migrator owner](../../../docs/operations/migrator-image.md) and
   [database roles](../../../docs/operations/database-role-separation.md) when schema
   application is required. Native endpoint capability and migration authority are
   distinct from runtime access, image scanning and ordinary application readiness.
4. Order migration, matching rollout, controlled checks and admission under the
   current guide. Preserve data, audit, queues and migration history. Assess what
   accepted writes do to rollback before exposing traffic.
5. For missing artifacts, unknown mutation results or unsupported compatibility,
   stop the affected admission and state the exact next evidence/action. Do not
   fabricate a success receipt or silently retry a state-changing procedure.

## Follow only applicable related owners

For a new storage deployment or provider change, read the current
[storage configuration](../../../docs/storage/configuration.md),
[provider matrix](../../../docs/storage/providers/README.md) and
[verification guide](../../../docs/storage/testing.md). Identify the provider,
bucket layout, public and private access paths, and checks for the target account.
For a move, follow the [migration guide](../../../docs/storage/migration.md).
Identify all writers, the pause and reconciliation boundary, and the recovery
point before changing targets. A storage diagnostic needs authority to write
and remove test objects in the chosen account. Follow the current
[storage runbook](../../../docs/operations/runbooks/storage.md) for an incident.

When adding or changing deployment metrics, logs or alert delivery, read the
[observability guide](../../../docs/operations/observability.md). For log search
also read [log search](../../../docs/operations/log-search.md) and its
[runbook](../../../docs/operations/runbooks/log-shipping.md). Preserve the saved
deployment selection. Plan separate evidence for collection, queries and
receiver delivery. Keep secret values out of reports. Diagnose a known alert
with its owning runbook. Do not add a monitoring change to an unrelated rollout.

For capacity measurement, read the [capacity reference](../../../docs/operations/capacity.md)
and [load testing](../../../docs/operations/load-testing.md). Reject a production
target. Identify the disposable project and retained resources before proposing
fixtures or load. Plan admission before measurement and independently verified
removal before project cleanup. Distinguish functional smoke from a comparable
capacity result. A normal rollout does not require a load campaign.

Use the [backup/recovery owner](../../../docs/operations/backup-restore.md) for
recovery prerequisites, and the [MFA deployment owner](../../../docs/auth/mfa-deployment.md)
for protocol compatibility. Initial organization setup or optional GeoIP follows
its own current guide when requested. Reading a prerequisite does not invoke an
entire recovery/rotation/activation workflow or grant its operational permission.
MFA activation and data restoration are outside this skill's execution authority.

Report exact intended/performed steps, artifacts/overlays/credentials by safe
reference, admission/rollback conditions, actual results and remaining gaps.
No secret values in reports or command arguments. Choose the smallest checks for
the changed risk; preserve prior compatible evidence instead of repeating whole
suites merely because time passed. Unknown state must stay unknown.
