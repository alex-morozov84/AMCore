# Operations

Runbooks and references for deploying and operating AMCore. For source integration,
start with [Create and update a product](updating-a-fork.md).

[Local development, previews and browser tests](local-stands.md). Agents use managed commands for local DB writes and previews.

## First deployment

For one server, follow [Single-host production](single-host-compose.md), using
approved registry images or its host-build path. Use [Capacity](capacity.md) to
size the host. For another topology, start with [Deployment platforms](deployment-platforms.md);
the matrix does not certify a provider or supply a complete platform recipe.

- [Production deploy profile](production-deploy-profile.md): artifact promotion,
  environment capabilities and adopter-owned pipeline implementation.
- [Deployment and migrations](deployment.md): complete overlays, runtime configuration,
  migration-before-rollout order, TLS, proxy trust and recovery limits.
- [Migration image](migrator-image.md): official CLI, exact-endpoint preflight,
  dependency maintenance and interrupted/unknown migration recovery.
- [Database role separation](database-role-separation.md): owner operations,
  runtime grants and safe adoption on an existing database.
- [First organization and administrator](../product-admin/organization-establishment.md):
  registration policy, trusted setup and recovery after an unknown result.
- [Operations Console](../operations-console/README.md): optional operator UI,
  topology, sessions and deployment. [Host proxy mappings](deployment.md#operations-console-host-mode-reference).

## Maintain and recover

- [Interrupted or unknown migration](migrator-image.md): stop rollout, establish
  actual ledger/SQL state and follow the linked recovery contract.

- [Backup and restore](backup-restore.md): database/local-file consistency,
  role-aware verification and the limits of scratch restore drills.
- [PostgreSQL major-version upgrade](postgresql-major-upgrade.md): choose a transfer
  method, close writers and respect rollback limits. Application/consumer validation
  must follow the guide; a restored database alone is insufficient.
- [Secret rotation](secret-rotation.md): affected consumers, replacement order,
  refusal handling and recovery limits for each secret class.
- [Open tabs after deployment](deployment.md#open-tabs-after-a-web-deployment):
  browser freshness and unsaved-input limits.
- [GeoIP setup](geoip-setup.md): optional approximate locations, update/storage
  requirements and missing or stale database behavior.
- [Load testing](load-testing.md): bounded capacity measurement on a disposable host.

## Diagnose incidents

- **[Observability](observability.md)** — Prometheus metric families, safe-label
  rules, structured logging and redaction, operator interpretation of the key
  metrics, the optional dev-only `monitoring` compose profile
  (Prometheus + Grafana + Alertmanager) that verifies them against this
  repo's own running stack, and shipped alert rules with dashboard panels.
  **Runbooks** (`runbooks/http.md`, `node-runtime.md`,
  `metrics-collector-health.md`, `log-shipping.md`, `db.md`, `redis.md`, `queues.md`, `email.md`,
  `realtime.md`) give each alert a symptom, ranked likely causes, diagnostic
  steps with executable diagnostic PromQL and the matching dashboard panel,
  mitigation, and escalation guidance. A static + live CI contract
  (`scripts/observability-contract/`, see the "Observability Contract
  Verification" section within this guide) keeps the metric↔alert↔
  dashboard↔runbook chain from silently drifting; the guide's "Change or
  extend observability" recipe shows how to update every linked artifact
  without weakening that contract.
- [Search application logs](log-search.md): request correlation, the optional log
  overlay, retention and [log-shipping recovery](runbooks/log-shipping.md).
- Query statistics: [bootstrap](pg-stat-statements-setup.md),
  [security](pg-stat-statements-security.md), [observer role](pg-stat-statements-observer-role.md),
  [exposure recovery](pg-stat-statements-recovery.md) and [slow-query investigation](slow-query-investigation.md).
- [File storage monitoring](runbooks/storage.md): local/S3 probe failures and recovery;
  [probe configuration](../storage/configuration.md#active-file-monitoring-and-readiness).
- [Telegram check](runbooks/telegram.md): provider reachability, token/relay failures and recovery.

## Extend safely

- [Audit log](audit-log.md): event shape, sensitive-data restrictions and write/read policy.
- [Webhooks](webhooks.md): inbound verification, replay protection and request limits.
- [Idempotency](idempotency.md): request fingerprinting, replay and failure behavior.
- **[Adding tests](adding-tests.md)** — discovery, local execution and CI group ownership.
- **[CI & repo security](ci-security.md)** — the CI security gates, what a fork
  inherits (and what it doesn't), the `strict`-mode `setup-repo-security.sh` step,
  the action-pin rules, and the local pre-commit size advisory.

In development, API processes with the `web` or `all` role serve Swagger UI at `/docs` for request and response contracts.
These guides explain operation and extension requirements.
