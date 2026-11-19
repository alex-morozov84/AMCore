---
name: amcore-backend-module
description: Add or change AMCore backend features, product email sending or templates, AI extensions, or environment configuration. Includes choosing direct or queued mail for an existing template. Excludes routine refactors, documentation and test-only changes.
---

# AMCore backend features

Read `PROJECT_CONTEXT.md`, the checkout's applicable instructions and the current
[backend recipe](../../../docs/backend/architecture-and-conventions.md).
Use the product's local guides and code; do not fetch upstream main as its policy.
Keep an existing correct product design unless the requested behavior requires change.

## Choose the actual change

Identify the reader-facing operation, actor, domain state and observable result.
Distinguish a new domain feature from a change to an existing contract.
Use the smallest module boundary that owns the behavior; do not create a framework,
cache, queue or new schema just to make every feature look the same.

For a standalone environment variable, use the recipe's environment section:
choose its schema/refinement, example, container consumers and typed reader.
Do not scaffold a feature that the user did not request.

## Choose how to send a product email

Read the [delivery decision tree](../../../docs/email/delivery.md#product-decision-tree)
and [secret rules](../../../docs/email/security.md) even when the template
already exists. Classify the link and payload first. Send a secret-bearing
email directly with `EmailService.sendNow()`. Read the
[template guide](../../../docs/email/templates.md) when the template changes.
Queue a non-secret template only after explicit classification for background delivery.
Use background-work for queued recovery and notification definitions. Use
integration-extension for provider checks and the [email runbook](../../../docs/operations/runbooks/email.md)
for incidents.

## Extend AI providers, assistants or tools

Choose the extension before changing code. Read [providers](../../../docs/ai/providers.md)
for model selection, credentials and endpoint policy. Read [assistants](../../../docs/ai/assistants.md)
for publishing an immutable configuration. For a tool, read [tools and approvals](../../../docs/ai/tools-and-approvals.md)
before choosing target authority and approval behavior. Read [AI security](../../../docs/ai/security.md)
before handling untrusted content or recording evidence.
Use background-work for run claims, retries and uncertain effects.
Use the integration owner for status-only reporting or operator probes.

## Connect the feature

1. Classify authoritative, cached, queued and external state. Keep product domains
   behind exported services; retain the shared-core exception in the recipe.
2. Read [schema contracts](../../../docs/backend/schema-validation.md). Put shared
   requests/responses in shared, declare native parameter schemas and typed success
   outcomes. Keep parsed input, response transforms and OpenAPI projection distinct.
3. Select persistence, DTO, service/mapping, controller and module responsibilities.
   Use current generated-client imports and reviewed migration history. A plan is
   not permission to migrate a retained database.
4. Identify credential/current-authority/context and record/field decisions.
   New policy or capability uses the authorization-extension workflow. Ordinary
   bearer wiring does not require changing existing policy or implementing login.
5. Keep HTTP producers and worker consumers in their owning process graphs.
   Choose the existing applicable tests and update OpenAPI inventory when needed.
   In a product, inherited starter tests do not certify the new domain's access.

## Read only the relevant additional owner

- HTTP plugins, streams or transport limits: [HTTP runtime](../../../docs/backend/http-runtime.md)
  and [request bodies](../../../docs/backend/request-body-contract.md).
- Shared packaging or runtime configuration: [shared build](../../../docs/backend/shared-package-build.md)
  or [runtime settings](../../../docs/backend/settings.md).
- Images and files: read [uploads](../../../docs/storage/uploads.md) and
  [media](../../../docs/media/README.md). Decide domain ownership, access and
  lifecycle before choosing keys and URLs. For public output, follow
  [public delivery](../../../docs/storage/public-files.md). For direct signed
  uploads, establish stable validated bytes before processing or publication.
  Avatar illustrates a single-pointer lifecycle. A gallery needs its own
  item ownership, deletion and replacement rules. Use deployment guidance
  when changing a storage provider or rollout, and background-work when the
  requested feature actually needs asynchronous processing.
- Search: define the backend query, filters, sort, pagination and authorized row
  scope. [Frontend search](../../../docs/frontend/search/README.md) owns UI
  patterns, not a backend engine or mandatory Console limits.
- Deferred work: use [background-work](../amcore-background-work/SKILL.md) for
  registration, business identity and replay/effect decisions. If unavailable,
  read the current [guide](../../../docs/backend/background-work.md) and report
  the missing entrypoint.
- Outside-service status, operator checks or callbacks: use
  [integration-extension](../amcore-integration-extension/SKILL.md). If unavailable,
  read [integrations](../../../docs/backend/integrations.md) and
  [webhooks](../../../docs/operations/webhooks.md); report the missing entrypoint.
- HTTP response caching: read [idempotency](../../../docs/operations/idempotency.md)
  before selecting the primitive; establish actor/tenant/resource ownership and
  durable business results for irreversible work. Ordinary CRUD needs no cache.
- Login/session protocol changes: auth-integration; durable events: audit-events.
  Use each only for that part of the task. If an entrypoint is unavailable, read
  its public owner and report the limitation instead of assuming it was applied.

## Check and report

Map each changed guarantee to the smallest applicable check under the current
recipe and test owners. Do not execute unapproved builds, databases or services
merely because a guide lists them. Keep implementation, planned checks and actual
results separate. State the domain boundaries, contract/authority/process choices,
changes, current-guide sources and unresolved risks. Report code/guide conflicts;
do not silently change behavior to make a statement true.
