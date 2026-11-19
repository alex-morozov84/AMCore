---
name: amcore-authorization-extension
description: Add or change AMCore capability, subject, tenant, record or field authorization, or API-key route eligibility. Excludes ordinary bearer wiring, login integration and operator UI use.
---

# AMCore authorization extensions

Read `PROJECT_CONTEXT.md`, applicable product instructions and the current
[RBAC contract](../../../docs/auth/rbac.md),
[capability catalogue](../../../docs/auth/capability-catalogue.md) and
[organization context](../../../docs/auth/organization-context.md).
Use the local product's rules. This workflow neither grants access nor authorizes
operations against a live installation.

## Establish the decision

Name the actor, accepted credentials, current authority, target organization and
requested operation. Distinguish implementing a rule from changing a user's role
through an existing UI. A successful login or a catalogue entry is not a grant.

A new ordinary bearer-only handler may reuse its existing admission policy.
Do not expand this into new role models or an authentication integration without
an actual change to the authorization decision.

## Extend enforcement and its description together

1. Identify the real handler/service boundary. Resolve current credential and
   privilege before admitting organization context and building one ability.
   Metadata/context selection does not replace domain authorization.
2. Follow the catalogue's extension order for subject/model fields, operations,
   presets and registry adapters. Register only what the domain actually enforces.
   A descriptor, UI hint or role-editor choice must not become the enforcement.
3. Combine the verified tenant predicate with accessible-record conditions using
   AND. Check actual returned rows/fields. Keep filtered lists, totals and action
   hints consistent; do not expose counts of hidden rows or query once per button.
4. For writes, validate allowed input fields and the trusted pre/post state in
   the same effect transaction. Preserve immutable tenant/assignment fields and
   current rights/revision checks. A prepared hint is not later write permission.
5. If API-key eligibility changes, read the [API-key owner](../../../docs/auth/api-keys.md)
   and current allowlist/OpenAPI requirements. Distinguish owner privilege, scope
   intersection and tenant binding; never enable credentials through metadata alone.
6. Keep current built-in/product registration and localized catalogue contracts
   aligned. Do not rewrite a managed or advanced rule merely to fit an editor.

## Prove the relevant boundary

Use product-specific cases for allowed and denied operations, other organizations,
record predicates, readable/writable fields and eligible credentials. Cover the
list/count/hint relationship and mutation pre/post-state where they change.
Adapt existing fixtures; do not claim that the starter-only extension command
validated a downstream module when it merely warned or skipped product work.

Use the backend-module workflow only when the feature wiring also changes.
Login/session publication belongs to auth-integration, not this policy workflow.
Read its public owner if a needed specialized skill is not available.

Report the implemented decision, actual enforcement path, synchronized descriptions,
checks performed and gaps. A plan, a passing typecheck or an authorable capability
is not an executed PostgreSQL access test. Stop the affected action when current
code and documented policy conflict; preserve evidence and report the discrepancy.
