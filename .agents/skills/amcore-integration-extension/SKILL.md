---
name: amcore-integration-extension
description: Connect an outside service to AMCore status reporting, reviewed operator checks, or inbound webhooks. Use in the starter and downstream products. Excludes ordinary CRUD, login protocols, and incident operations.
---

# AMCore outside-service integration

Read `PROJECT_CONTEXT.md` and applicable local instructions. Use current product
owners, not fetched upstream main. Select only the requested parts below.
A service connection does not require every status, probe, webhook or queue.

## Establish the operation

Identify the service, actor, authoritative business state and observable result.
Separate configuration, stored observation, provider acceptance and completed
effect. Name the process that calls the provider and the process that reads status.
Use [backend-module](../amcore-backend-module/SKILL.md) for feature/contracts/HTTP
wiring, without treating inherited tests as proof of product business rules.

## Report status or add an operator action

Read the current [registration guide](../../../docs/backend/integrations.md) and
[operator guide](../../../docs/operations-console/integrations.md).

- Keep status reads free of outside-provider calls and effects. Read existing
  observations or bounded technical state. Preserve unknown, stale and missing
  evidence; refreshing a page does not create a measurement.
- Register the owning module and reader through composition. Preserve semantic
  secrecy as well as schema shape, localized copy and startup validation.
- Distinguish a stored status reader from an operator probe. A new capability
  needs its reviewed kind, admission and safe receipt contract. A registration
  cannot turn a fixed email test into an arbitrary URL or recipient command.
- Follow current personal authority, preparation/confirmation, limits and
  read-only recovery. Lost answers and unknown outcomes do not authorize a new
  effect. A row timeout or aborted signal does not prove physical cancellation.

## Receive a callback or repeat an HTTP operation

For inbound events, read [webhook verification](../../../docs/operations/webhooks.md)
and the [request-body owner](../../../docs/backend/request-body-contract.md).
Choose the actual provider family, exact raw bytes, configuration, public auth
and rate limit. Do not assume every family has a timestamp or Redis dedupe.

Define durable event identity, authorized target, commit/result, acknowledgement
and retention before relying on retries. Verification and a Redis hint do not
prove completed business work. A guard can mark an event before the handler fails.

If considering HTTP response caching, read
[HTTP idempotency](../../../docs/operations/idempotency.md) first. Establish current
resource/tenant/actor authorization and result ownership. Static scope/key and
raw-body fingerprints do not supply those boundaries. Use domain-owned durable
identity/results for irreversible effects; do not select a new key after an
unknown outcome merely to get execution past the cache.

## Keep adjacent owners separate

- Deferred/timer work: [background-work](../amcore-background-work/SKILL.md),
  including business authority, process roles, retries and unknown effects.
- Login/session protocol: auth-integration; new policy: authorization-extension.
- Operational deployment, recovery or credential rotation: their existing skills.
  A development request does not authorize live provider calls or maintenance.

Read only the adjacent owner needed for the requested change. If its entrypoint
is unavailable, read its public guide and report the missing delivery path.

## Verify and report

Map changed guarantees to the current guides' smallest applicable checks.
Distinguish schema/startup tests, adapter/Redis behavior and actual business
commit or provider effects. A correct plan does not establish working code.
Report the selected parts, guides actually read, implementation and evidence
limits. Follow current docs-impact review for consuming skills; keep commands,
policy values and procedures in their owning guides. A changed guide requires
rereading the affected owner, not automatic synchronization or copied policy.
Do not execute unapproved tests, services or provider actions.
