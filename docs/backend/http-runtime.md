# API HTTP runtime

AMCore runs NestJS 12 on Fastify 5. `web`, `all` and the worker's health-and-metrics
HTTP server use one production adapter. There is no runtime adapter switch.
Commands, ports, process roles, endpoint schemas and authentication remain in
their existing guides. Swagger remains development-only and absent on workers.

## Bootstrap and plugins

`main.ts` calls `createHttpAdapter` and `configureHttp`. E2E fixtures use the
same helpers through `createHttpTestApp`. Startup order is intentional:

```text
role/module selection -> Fastify adapter -> board early refusal
  -> body parsers/cookies/security headers -> CORS -> routes -> listen
```

- `@fastify/cookie` supplies request cookies and response cookie methods.
- `@fastify/helmet` supplies API security headers after parser admission. The
  queue board owns its own closed headers; it refuses preflight before CORS.
- `@fastify/compress` decodes supported compressed requests. Automatic response
  compression is disabled. TLS and browser headers remain edge/web concerns.
- Nest's Fastify upload interceptors register `@fastify/multipart` when used.
- `@bull-board/fastify` and `@fastify/view` serve the bounded read-only board.

Read [request bodies](request-body-contract.md) for decoded and encoded limits,
Unicode/forms, safe JSON, raw webhook bytes and fixed parser failure statuses.
Multipart file limits are independent of JSON/form limits.

## Adding or changing a handler

Prefer returned values and the shared Standard Schema/Zod contract. Keep response
validation enabled; no Fastify response-schema serialization shortcut is assumed.

Use `FastifyRequest` and `FastifyReply` for new platform-specific controller
parameters. Nest middleware receives raw Node request/response objects, not these
wrappers. Existing structural Express type references describe tested common/raw
fields; they are erased at build time and do not provide Express methods.

For uploads, import `FileInterceptor` from `@nestjs/platform-fastify` (or its
`multipart` export). Keep explicit per-route file-size limits and existing
magic-byte validators. Do not import Express upload interceptors into production.
Do not register multipart a second time after application initialization.

Fastify cookie `maxAge` is **seconds**. Preserve HttpOnly, Secure, SameSite, path
and matching clear-cookie scope. OAuth binding cookies and refresh cookies keep
separate lifetimes and scopes. Use status-before-redirect semantics:
`reply.status(302).redirect(url)`.

For SSE, follow the existing stream helper: use `reply.raw` and `reply.hijack()`
after authorization and stream admission. Close timers/listeners on abort and finish.

Authorized storage downloads return a Nest-managed `StreamableFile`; do not hijack
that response. The primitive streams the full object as a safe attachment and sets
metadata headers. It does not implement Range or conditional responses; Range is
ignored. ETag/Last-Modified headers alone do not provide 206/304 handling. Fastify
suppresses HEAD response bodies, but the focused storage fixture checks GET only;
verify the actual consumer before promising a HEAD contract. Use the HTTP adapter
for exception replies; do not call Express-only `res.json()`.
Idempotency captures the Fastify serialized response through its response hook;
replays preserve stored body bytes and selected headers.

## Proxy, observability and board boundaries

`TRUST_PROXY=false` remains the default. Prefer explicit trusted proxy IP/CIDR
lists. Numeric hop counts retain the existing contract through a custom trust
function; they are safe only when network access guarantees the intended proxy
chain. A direct caller can spoof forwarded values when a hop-only origin is
publicly reachable. Do not use broad `true` without an isolated, sanitizing edge.
The BFF client-IP relay validates the actual socket peer independently.
See [deployment](../operations/deployment.md#tls--reverse-proxy).

Pino/CLS, rate limiting and audit use tested request metadata. Metrics use route
templates, not unbounded URLs, and balance finish/abort events. The worker exposes
health and authenticated metrics, without business API, Swagger or the queue board.
Disabling the queue board removes its plugin and board-owned refusal
boundary; it does not mount a hidden UI.

The board's Fastify adapter preserves authentication, read budgets, closed error
projections, per-request locale/context and pinned display assets. It rejects
non-read methods before parsers/CORS. Malformed case aliases keep fixed errors
and security headers. This integration is maintained project code, not a general
Express compatibility framework.

## Dependency and upgrade checks

Update Nest core and its HTTP adapters together. The current Nest 12.2.0
Fastify adapter requires Fastify 5.12.7; keep the direct Fastify dependency aligned
so plugins and the adapter share one resolved Fastify version.

`@nestjs/platform-express`, `@bull-board/express`, `express` and `cookie-parser`
are development controls. Their helpers live under `test/support`; the API build
does not emit them. `@types/express` remains development-only for structural
boundaries. A transitive package or optional peer is not another running adapter.

Run affected `http-*-admission.spec.ts` fixtures with the API test command after
Nest/Fastify/plugin updates. Include parser security/encodings/limits, cookies,
proxy identity, errors, uploads/downloads, SSE cancellation, idempotency, metrics
and board method/header/disabled boundaries as applicable. Pinned board asset
hashes must be revalidated against a deliberate UI upgrade. Run typecheck and
build; the API build requires a successful typecheck before SWC emission. Each API build cleans `dist` first
to remove deleted or renamed modules. Full API E2E, generated starter
install/build/test and platform image/deploy checks remain separate CI gates.

## Why Fastify

Fastify is a supported Nest platform with native cookie, multipart and other
plugin integrations. AMCore uses those integrations while retaining its parser
and closed board policies. These project-owned boundaries need maintenance when
Nest, Fastify or plugins change. Express remains a supported Nest alternative;
this choice does not imply it is obsolete.

An HTTP adapter alone does not guarantee lower latency, higher throughput or less
memory. Measure the complete application on representative workloads and deployment
topology before claiming an improvement. The adapter choice does not establish
TypeScript 7 readiness.

## Rollback

Roll back the adapter, bootstrap, plugins, dependency manifest/lock and affected
HTTP contracts together to a reviewed Express application image. There is no
production flag that safely swaps only the adapter. Restore the matching proxy,
cookie, body-error and stream behavior; run affected compatibility checks before
rollout. Independently useful parser corrections can be retained through a
separate reviewed change. Preserve database records, queues, Redis keys, rate
counters and idempotency receipts. Never use state deletion as an adapter rollback.

References: [Nest Fastify](https://docs.nestjs.com/techniques/performance),
[Nest uploads](https://docs.nestjs.com/techniques/file-upload),
[Fastify trustProxy](https://fastify.dev/docs/latest/Reference/Server/#trustproxy).
