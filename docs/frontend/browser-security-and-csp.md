# Browser security headers and Content Security Policy

`apps/web` ships a real, non-decorative browser security-header baseline:
static headers for every response, a nonce-based Content Security Policy
(CSP) for HTML/navigation requests, and a minimal violation-reporting
endpoint. This page is the public operating contract for downstream forks:
what is enabled, where to change it, and what must be verified before
weakening or extending the policy.

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

Under `next dev` only, AMCore appends `'unsafe-eval'` to `script-src`
because React uses it for development diagnostics; production never gets
that allowance.

`script-src` has no `'unsafe-inline'` — App Router's RSC Flight payload is
always an inline `<script>`, and Next's own `experimental.sri` cannot cover
it (only external bootstrap/preinit files get `integrity`, per the
installed framework source). A per-request nonce, generated in
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

- be rendered by this app with the request nonce, usually via Next's
  `<Script nonce={nonce}>` after reading
  `(await headers()).get('x-nonce')` in a Server Component; or
- be loaded by another script that was already trusted by nonce.

Do **not** assume that adding `https://provider.example` to `script-src`
is enough. In CSP3 browsers, `'strict-dynamic'` makes host allowlists a
legacy fallback for scripts: a parser-inserted external `<script>` still
needs a nonce. Host entries may still be useful for older browsers or
non-script directives, but the modern path is "nonce the provider's
bootstrap script, then let that trusted script load what it needs."

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

1. **Do not narrow `src/proxy.ts`'s `matcher` to exclude the new public
   route group.** This looks like the obvious fix and is wrong: the
   matcher governs `next-intl`'s locale routing too, not just the CSP
   logic riding alongside it — every route lives under a `[locale]`
   segment (see [Locale routing](./architecture-and-conventions.md#locale-routing)),
   so excluding a route from the matcher breaks its locale
   detection/redirects entirely, not just its CSP. Verified live: narrowing
   the matcher for a test path made that path 404/misroute, not "get a
   relaxed policy."
2. **Instead, branch inside `proxy()` itself.** Keep the matcher as-is (so
   `next-intl` still runs for every route), but skip the
   `response.headers.set(cspHeaderName, cspHeaderValue)` call — and the
   nonce/`x-nonce` request-header logic — for the new public route group's
   paths. `next-intl`'s own routing still applies to them; only AMCore's
   CSP response header is conditionally skipped.
3. **Only then does a separate `next.config.ts` `headers()` entry, scoped
   to that route's `source` pattern, actually take effect** (static
   hash-based or a documented `'unsafe-inline'` baseline, labeled honestly
   as weaker, not a recommendation — just an honest fallback for content
   that can't take the dynamic-rendering cost). This is not optional
   ordering advice: verified live that if `proxy()` still sets the CSP
   response header for a path, it silently **overwrites** whatever
   `next.config.ts` set for that same header name and path — a
   `next.config.ts` entry alone, without step 2, achieves nothing.
4. **For a high-cache public marketing surface, consider a separate Next
   [multi-zone](https://nextjs.org/docs/app/guides/multi-zones) or a
   separate domain entirely instead of steps 1–3.** A genuinely separate
   Next app shares neither `src/proxy.ts` nor `app/[locale]/layout.tsx`
   with the authenticated app, so there's no CSP wiring to route around at
   all — the least error-prone option once the surface is large enough to
   justify it.

## Known conflict: Cache Components / Partial Prerendering

Next 16's Cache Components (`cacheComponents: true`, formerly Partial
Prerendering) is not enabled in AMCore, and turning it on conflicts with
nonce-based CSP as currently implemented: generating a nonce means reading
`headers()`, which under `cacheComponents` must happen inside a
`<Suspense>` boundary — but a pre-paint script (the theme-init script in
`app/[locale]/layout.tsx`, and Next's own inline Flight-payload script)
needs its nonce before first paint, not after a Suspense boundary resolves.
This is a genuine upstream limitation, not an AMCore gap:
[vercel/next.js#89754](https://github.com/vercel/next.js/issues/89754)
tracks the exact shape (confirmed, open as of this writing).

If your fork wants to adopt Cache Components, budget time to resolve this
conflict first (or track the upstream issue for a fix) — do not assume the
two features compose cleanly just because both are documented
independently.

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

## Deployment requirement: preserve the Proxy-added request CSP header

Next reads the nonce from the **request's** `Content-Security-Policy` /
`-Report-Only` header, not the response. AMCore's `src/proxy.ts` generates
that header itself after first deleting any hostile or stray inbound CSP
headers from the browser/upstream edge.

The operational requirement is therefore precise: if your hosting platform
or custom adapter runs Proxy at one layer and renders the App Router page at
another, the **Proxy-modified request headers** must survive that internal
Proxy -> renderer hop. If that internal path strips security-looking
headers, Next silently emits framework scripts with no nonce, and hydration
breaks the moment enforcement is on. Verify this on the deployed artifact
before relying on `enforce`; see `docs/operations/deployment.md` → "TLS &
reverse proxy".

Do not configure an outer CDN/WAF to trust or inject client-supplied CSP
request headers as input to AMCore. AMCore owns the nonce and policy for
its own HTML responses; the edge should preserve AMCore's generated
response headers and must not interfere with Next's internal request-header
propagation.

## See also

- [Testing § CSP and security headers](./testing.md#csp-and-security-headers) —
  which layer proves what, and why `next dev` can't prove "zero violations."
- [Brand, theme, and design tokens](./brand-theme-and-tokens.md) — the
  theme-init script this policy nonces.
- [API consumption](./api-consumption.md) — the BFF session-vault pattern
  behind AMCore's own dynamic-rendering trade-off, and
  `WEB_TRUSTED_CLIENT_IP_HEADER`, reused for the reporting endpoint's rate
  limit key.
- `docs/operations/deployment.md` → "TLS & reverse proxy" — deployment
  requirements for TLS, forwarded headers, and CSP nonce propagation.
