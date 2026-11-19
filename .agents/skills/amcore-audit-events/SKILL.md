---
name: amcore-audit-events
description: Add or change a persistent AMCore audit event or safe operator projection. Excludes diagnostic logging, metrics, alerts and browsing audit history.
---

# AMCore durable audit events

Read `PROJECT_CONTEXT.md`, applicable instructions and the current
[audit extension guide](../../../docs/operations/audit-log.md#add-an-audited-action).
A diagnostic log, metric or history lookup does not require a new audit action.

## Decide what the event proves

Name the actor, target, operation and required durability. Separate a committed
state change from an accountable read and a best-effort observation after an effect.
Choose the existing transaction, strict read or default recording mode according
to the owner. Do not serve an accountable resource before its required audit succeeds.
A lost response is not proof that the state change or its audit rolled back.

## Extend the complete safe path

1. Register the typed action and metadata specification. A TypeScript union does
   not itself validate arbitrary runtime action input.
2. Use bounded identifiers, counts and coded classifications. Primitive and array
   allowlists do not impose length/content limits or automatically redact secrets.
   Preserve only explicitly approved bounded operational-reason exceptions.
3. Record at the service/effect boundary with the selected durability. Preserve
   atomic audit/effect rollback when required; a postcommit log is not a substitute.
4. If operators need a new summary, update the safe shared/API projection and
   localized display, rather than exposing raw metadata. Read the current
   [Console audit guide](../../../docs/operations-console/audit.md) for what a
   displayed result actually proves.
5. For a setting, read [complete settings audit integration](../../../docs/backend/settings.md#complete-the-audit-integration).
   A new definition alone does not extend the sanitizer, summary or UI meaning.

## Check and report

Choose meaningful cases for effect/audit failure, permitted fields, rejected
content and projection, using the current test owners. A record's presence does
not establish uninterrupted authority, current identity facts or completion of
already admitted work. Append-only triggers are not protection against every
privileged DDL operation.

Report the action, write mode, metadata/projection changes, actual checks and
execution limits. Keep sample secrets obviously fake. Do not add a generic audit
framework or change logging/metrics policy to implement a single event. Do not
execute database or operational procedures without their separate authority.
