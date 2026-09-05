# Browser security headers and Content Security Policy

`apps/web` ships a real, non-decorative browser security-header baseline:
static headers for every response, a nonce-based Content Security Policy
(CSP) for HTML/navigation requests, and a minimal violation-reporting
endpoint. Full design rationale, options considered, and the two-agent
review that produced this: **ADR-074**
(`ai/decisions/adr-074-web-nonce-based-csp-and-security-headers.md`, private
maintainer repository).

## What's enabled by default

**Static headers** (`apps/web/next.config.ts`'s `headers()`, every response
including `/api/*` Route Handlers and static files):

| Header                      | Value                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                                                                                          |
| `X-Content-Type-Options`    | `nosniff`                                                                                                                                  |
| `Permissions-Policy`        | Denies unused browser features (camera, microphone, geolocation, gyroscope, magnetometer, payment, USB, and the FLoC/Topics tracking APIs) |
| `X-Frame-Options`           | `DENY` (legacy companion to CSP's `frame-ancestors`)                                                                                       |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains`, no `preload` — see [HSTS](#hsts) below                                                              |

**Content-Security-Policy** (`apps/web/src/proxy.ts`, HTML/navigation
requests only — the next-intl matcher excludes `/api/*`, `_next`,
`_vercel`, and any dotted path):

```
default-src 'self';
script-src 'self' 'nonce-<per-request>' 'strict-dynamic';
style-src-elem 'self' 'nonce-<per-request>';
style-src-attr 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self';
worker-src 'self';
manifest-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests;         (* production only *)
report-uri /api/csp-report;
report-to csp-endpoint;
```

`script-src` has no `'unsafe-inline'` — App Router's RSC Flight payload is
always an inline `<script>`, and Next's own `experimental.sri` cannot cover
it (only external bootstrap/preinit files get `integrity`, per the
installed source — see ADR-074). A per-request nonce, generated in
`src/proxy.ts` and threaded through `x-nonce` to the theme-init script and
Base UI's `CSPProvider`, is the only mechanism that actually restricts
script execution here.

`style-src-attr` stays `'unsafe-inline'` deliberately:
`shared/ui/sidebar.tsx` renders three intentional `style={...}`
CSS-custom-property attributes in server-rendered dashboard HTML. Per Base
UI's own CSP docs, `style-src-attr` governs a materially smaller attack
surface than `style-src-elem`/`script-src` (inline _attributes_ on markup
the page already controls, not arbitrary injected elements).

## Enforcement mode

`WEB_CSP_MODE` controls whether the browser blocks a violation or only
reports it:

- **`enforce`** — the browser actually blocks a script/style that violates
  the policy. **AMCore's production default.**
- **`report-only`** — the browser reports violations without blocking
  anything. **`next dev`'s default** — not caution for its own sake:
  Turbopack's own HMR machinery injects dozens of inline `<style>` tags for
  its own tooling, and enforcing there blocks every one of them (confirmed
  against a real browser), trading a noisy console and probably broken CSS
  hot-reload for no real security benefit, since `next dev` never ships.

Leave `WEB_CSP_MODE` unset to get the environment-appropriate default in
both directions. Set it explicitly to override either way — including
running `report-only` in a real production deployment while integrating a
new third-party script/style origin. That is an **explicit weakening**,
not a supported permanent posture: fix the policy (see
[Adding a third-party origin](#adding-a-third-party-origin-safely) below)
and flip back to `enforce` once it's verified clean, the same rollout this
track itself used (Report-Only first, `docker-compose.yml`'s
`local-infra` real-stack Playwright suite confirmed zero violations, then
`enforce` became the default).

```bash
# .env / docker-compose.yml
WEB_CSP_MODE="report-only"   # temporarily weaken a production deployment
WEB_CSP_MODE="enforce"       # force enforcement locally, e.g. to reproduce a violation
```

An unrecognized value throws at request time rather than silently falling
back — see `apps/web/src/shared/lib/csp/csp-mode.ts`.

## HSTS

`Strict-Transport-Security` is emitted unconditionally (not gated on
`NODE_ENV`). Per RFC 6797 §8.1 a user agent must ignore the header entirely
over plain HTTP, so this is a genuine no-op under `next dev`/local HTTP.

**On any real HTTPS deployment — including a preview/staging domain, not
only production — a browser caches the 2-year `max-age` pin on first
visit.** A domain that later needs to downgrade to HTTP, or that shares a
parent domain with something that can't guarantee HTTPS on every
subdomain, is pinned for two years the moment someone opens it once.

`preload` is **not** included by default. Submitting a domain to the HSTS
preload list is a domain-owner commitment covering all subdomains and is
effectively irreversible for months (removal from browsers' shipped
preload lists lags submission by a similar order). Opt in only for a
production domain you're certain will stay HTTPS-only indefinitely, by
editing the `Strict-Transport-Security` value in `next.config.ts` directly
and submitting to [hstspreload.org](https://hstspreload.org) yourself —
this is a one-time, deliberate operational decision, not a configuration
flag this starter flips for you.

## Adding a third-party origin safely

A new analytics/payments/maps/chat/embed/font/media provider almost always
needs a `connect-src`/`img-src`/`frame-src`/`font-src` addition — never
`'unsafe-inline'` for `script-src`, which defeats the nonce policy
entirely. Edit the directive list in
`apps/web/src/shared/lib/csp/build-csp.ts` (`buildCspDirectives`), covered
by `build-csp.test.ts`. If the provider ships its own script that needs to
run, it must either:

- load from an allowlisted origin under `script-src` (still `'self'
'nonce-...' 'strict-dynamic'` plus the provider's host — `'strict-dynamic'`
  then trusts scripts that origin's nonced script itself loads, so a single
  host entry is usually enough), or
- be rendered via Next's `<Script>` component with the request nonce
  (`(await headers()).get('x-nonce')`, the same pattern
  `app/[locale]/layout.tsx` already uses for the theme-init script).

Verify with `WEB_CSP_MODE=enforce` locally and a real browser console free
of `securitypolicyviolation` before shipping — not just the mocked
Playwright lane (`next dev`'s own HMR noise makes "zero violations" the
wrong assertion there; see [Testing](./testing.md#csp-and-security-headers)).

## Downstream forks: public/marketing routes and route scoping

AMCore's own core routes accept the dynamic-rendering cost of per-request
nonces because the BFF session-vault pattern (`docs/frontend/api-consumption.md`)
already reads `cookies()`/`headers()` on nearly every route — the marginal
cost is small (verified: 7 of 9 page routes were already dynamic before
this track). **This does not generalize.** A downstream fork that adds
genuinely public marketing/landing pages under the same `[locale]` layout
would lose static rendering on those pages purely as a side effect of the
global CSP wiring in `app/[locale]/layout.tsx`, not because the new pages
need it.

No code ships for this in the starter — AMCore itself has no such route
group today — but the supported pattern for a fork that does is:

1. **Scope the strict nonce policy to an authenticated/app-shell route
   group.** Narrow `src/proxy.ts`'s `matcher` to the routes that actually
   need per-request nonces (e.g. everything under `(dashboard)`), so
   `next-intl`'s middleware — and therefore the nonce/CSP logic riding
   inside it — never runs against the new public route group.
2. **Give the public route group its own, relaxed policy** via a
   `next.config.ts` `headers()` entry scoped to that route's `source`
   pattern (static hash-based or a documented `'unsafe-inline'` baseline,
   labeled honestly as weaker — see ADR-074's options-considered table for
   why that shape is measured-decorative, not a recommendation, just an
   honest fallback for content that can't take the dynamic-rendering cost).
3. **For a high-cache public marketing surface, consider a separate Next
   [multi-zone](https://nextjs.org/docs/app/guides/multi-zones) or a
   separate domain entirely**, so it can be statically generated/CDN-cached
   without inheriting the authenticated app's rendering model at all.

## CSP violation reports

`app/api/csp-report` is a minimal, same-origin, unauthenticated endpoint
that both CSP reporting mechanisms point at (`report-uri` for broad
browser support, `report-to` + the `Reporting-Endpoints` response header
for the current Reporting API). It is **observability, not a protection
mechanism**, and deliberately does not grow into one:

- Accepts only `application/csp-report` (legacy) and
  `application/reports+json` (current) — anything else is a silent `204`.
- Caps the body at 16KB, checked against both `Content-Length` and the
  actual bytes read.
- Applies a best-effort Redis fixed-window rate limit (20 requests/10s per
  client, or a shared bucket if `WEB_TRUSTED_CLIENT_IP_HEADER` — see
  `docs/frontend/api-consumption.md` — is not configured), failing open on
  any Redis trouble rather than ever hanging or `500`ing this public
  endpoint.
- Logs a normalized, **allowlisted** summary via `console.warn` — no new
  storage, no dashboard. Query strings, `referrer`, `user_agent`, and the
  echoed-back policy text are dropped; the violation sample is truncated to
  100 characters.

**A production deployment that wants more than log lines** should route
this traffic to its own observability stack or an external CSP reporting
provider instead of this starter growing an analytics subsystem in-house —
either replace `apps/web/src/shared/lib/csp/csp-report-handler.ts`'s body
entirely, or point the `report-uri`/`report-to`/`Reporting-Endpoints`
values (`apps/web/src/shared/lib/csp/constants.ts`,
`apps/web/src/proxy.ts`) at an external collector.

## CSP-sensitive Base UI components

`app/[locale]/layout.tsx` wraps the whole app in Base UI's `CSPProvider`
with the same per-request nonce, so any Base UI component that renders an
inline `<style>`/`<script>` tag should pick it up automatically. Four
primitives do this today per the installed `@base-ui/react` CSP docs —
`ScrollArea`, `Select` with `alignItemWithTrigger`, `Tabs.Indicator`, and
`Slider.Thumb` — and none of them are used in `shared/ui` yet.

`shared/ui/csp-inline-tag-components-guard.test.ts` is a deliberate
trip-wire: it fails the moment any of the four is introduced anywhere in
`shared/ui`, forcing a real-browser check
(`WEB_CSP_MODE=enforce`, console free of `securitypolicyviolation`) before
the guard can be updated to allow it. Global wiring making something
"should just work" is not the same as verifying it does.

## Deployment requirement: forward the request-side CSP header

Next reads the nonce from the **request's** `Content-Security-Policy` /
`-Report-Only` header, not the response (see ADR-074's framework-constraint
section). Any edge/CDN/WAF/reverse proxy in front of a real deployment
**must forward that header through on the request path unmodified.** An
edge that strips inbound security-looking headers by default — a real,
documented pattern for several WAFs/CDNs — would silently degrade every
framework-injected script to unnoned, breaking hydration the moment
enforcement is on. Verify this explicitly for your own edge configuration
before relying on `enforce` in production behind it; see
`docs/operations/deployment.md` → "TLS & reverse proxy".

`src/proxy.ts` separately defends against the _opposite_ problem — a
hostile or stray inbound CSP header being trusted instead of overwritten —
by deleting both possible header names before setting its own. That
protects nonce integrity against a header arriving from upstream of your
edge; it cannot make an edge that drops the header before it reaches
`apps/web` forward one it never received.

## See also

- [Testing § CSP and security headers](./testing.md#csp-and-security-headers) —
  which layer proves what, and why `next dev` can't prove "zero violations."
- [Brand, theme, and design tokens](./brand-theme-and-tokens.md) — the
  theme-init script this policy nonces.
- [API consumption](./api-consumption.md) — the BFF session-vault pattern
  behind AMCore's own dynamic-rendering trade-off, and
  `WEB_TRUSTED_CLIENT_IP_HEADER`, reused for the reporting endpoint's rate
  limit key.
- `docs/operations/deployment.md` → "TLS & reverse proxy" — edge/CDN header
  forwarding requirements.
- ADR-074 (`ai/decisions/`, private) — full rationale, options considered,
  and the security fix found during this track's own review.
