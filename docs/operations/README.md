# Operations

Runbooks and contracts for deploying, running, and operating AMCore in
production. Start with [deployment](deployment.md); reach for the others when a
specific concern comes up.

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
- **[Observability](observability.md)** — Prometheus metric families, safe-label
  rules, structured logging and redaction, and operator interpretation of the
  key metrics.
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
