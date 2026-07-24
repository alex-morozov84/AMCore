# Operations

Runbooks and contracts for deploying, running, and operating AMCore in
production. Start with [deployment](deployment.md); reach for the others when a
specific concern comes up.

- **[Deployment & migrations](deployment.md)** — clone → migrate → run, locally
  and in production. One-shot `prisma migrate deploy`, production env
  requirements, the `web` / `worker` / `all` process roles, TLS/reverse-proxy
  setup (nginx example, the optional bundled Caddy `edge` profile, and
  `TRUST_PROXY`), the Redis queue profile, database pool sizing, and
  SSE-behind-a-proxy guidance.
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
