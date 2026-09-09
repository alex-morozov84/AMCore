# Operations

Runbooks and contracts for deploying, running, and operating AMCore in
production.

**Setting up production for the first time?** Work through these six in order —
each one assumes the previous is done:

1. [Production deploy profile](production-deploy-profile.md) — the
   build-once/promote-by-digest contract and the GitHub Environments/secrets
   checklist everything else assumes.
2. [Deployment & migrations](deployment.md#production-rollout-via-registry-image-pull-path) —
   the `docker-compose.prod.yml` overlay, TLS/reverse proxy, process roles, and
   the migration contract.
3. [Database role separation](database-role-separation.md) — a migrator role
   distinct from the app's runtime role.
4. [Backup & restore](backup-restore.md) — a strategy, plus the `restore-drill`
   that proves it actually restores.
5. [Secret rotation](secret-rotation.md) — before you need it, not during.
6. [Deployment platforms](deployment-platforms.md) — only if you are not on a
   VPS.

Already running? Reach for whichever concern below applies.

- **[Deployment & migrations](deployment.md)** — clone → migrate → run, locally
  and in production. One-shot `prisma migrate deploy`, production env
  requirements, the `web` / `worker` / `all` process roles, TLS/reverse-proxy
  setup (nginx example, the optional bundled Caddy `edge` profile, and
  `TRUST_PROXY`), the opt-in BFF client-IP relay that lets the global
  rate limiter tell visitors apart (`WEB_TRUSTED_CLIENT_IP_HEADER` +
  `TRUSTED_WEB_PEERS`), the Redis-backed GCRA rate limiter's production
  assumptions, the Redis queue profile, database pool sizing,
  SSE-behind-a-proxy guidance, and the `docker-compose.prod.yml` image-pull
  rollout (immutable digests, restart policies, log rotation, honest
  zero/low-downtime guidance).
- **[Production deploy profile](production-deploy-profile.md)** — the
  build-once/promote-by-digest contract, the `staging`/`production` GitHub
  Environments setup, and the secrets/variables checklist that gates a
  registry-based production deploy.
- **[Backup & restore](backup-restore.md)** — which backup strategy fits your
  deployment (managed-provider PITR, self-hosted WAL archiving, or the
  logical-dump fallback), the optional compose `backup`/`restore` profiles
  this repo ships, and the `restore-drill` profile that rehearses an actual
  restore on a schedule instead of only taking backups.
- **[Database role separation](database-role-separation.md)** — a
  migrator/owner role for `prisma migrate deploy` versus a DML-only runtime
  role for the running app, the setup script, and adopting it on an existing
  database.
- **[Secret rotation](secret-rotation.md)** — what actually happens (verified
  against this repo's real request path and a real Postgres) when you rotate
  `JWT_SECRET`, database credentials, `REDIS_URL`, OAuth secrets, or
  third-party API keys: what breaks, what doesn't, and how to bound or avoid a
  maintenance window for each.
- **[Deployment platforms](deployment-platforms.md)** — a decision matrix, not
  a recipe collection: how AMCore's `api`/`worker`/Redis/Postgres/SSE actually
  map onto Kubernetes, Cloud Run, Fly, Render, Railway, and (with a hard
  web-only caveat) Vercel, sourced and dated against each platform's own docs.
  VPS/Compose remains the one platform with a full owned recipe.
- **[Observability](observability.md)** — Prometheus metric families, safe-label
  rules, structured logging and redaction, operator interpretation of the key
  metrics, the optional dev-only `monitoring` compose profile
  (Prometheus + Grafana + Alertmanager) that verifies them against this
  repo's own running stack, and shipped alert rules with dashboard panels.
  **Runbooks** (`runbooks/http.md`, `node-runtime.md`,
  `metrics-collector-health.md`, `db.md`, `redis.md`, `queues.md`, `email.md`,
  `realtime.md`) give each alert a symptom, ranked likely causes, diagnostic
  steps with executable diagnostic PromQL and the matching dashboard panel,
  mitigation, and escalation guidance. A static + live CI contract
  (`scripts/observability-contract/`, see the "Observability Contract
  Verification" section within this guide) keeps the metric↔alert↔
  dashboard↔runbook chain from silently drifting.
- **`pg_stat_statements`** — [Bootstrap](pg-stat-statements-setup.md) (a
  one-time privileged step, never a migration), [security
  settings](pg-stat-statements-security.md), [the `amcore_observer`
  role](pg-stat-statements-observer-role.md) (fail-closed `NOLOGIN` →
  `\password` → `LOGIN`), and [Recovery](pg-stat-statements-recovery.md) if
  a password may have leaked through it.
- **[Slow query investigation](slow-query-investigation.md)** — triage
  queries once the above is set up — the tool the DB runbook's Slow queries
  entry points to for "which query," not just "that queries are slow."
- **[CI & repo security](ci-security.md)** — the CI security gates, what a fork
  inherits (and what it doesn't), the `strict`-mode `setup-repo-security.sh` step,
  and the action-pin rules.
- **[Audit log](audit-log.md)** — the append-only privileged-action trail: row
  shape, sensitive-data rules, write modes, and read-access policy.
- **[Webhooks](webhooks.md)** — the inbound webhook verification primitive:
  raw-body signature/secret verification, replay protection, body-size limits,
  and the error contract.
- **[Idempotency](idempotency.md)** — the opt-in HTTP idempotency primitive for
  unsafe `POST`s: fingerprinting, replay semantics (first result wins, including
  `5xx`), and fail-open/closed behavior.

Endpoint shapes live in the Swagger/OpenAPI document at `/docs`; these runbooks
cover operation, not request/response schemas.
