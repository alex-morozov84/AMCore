# Operations Console

The Operations Console is AMCore's optional, foundation-only system control
plane. Today it provides the protected Control Room shell, an overview
placeholder, live admission, and host-mode login/logout plumbing. It does not
ship operational panels, generic CRUD, or a product backoffice.

## Boundary and access

Only `SystemRole.SUPER_ADMIN` can use the console. Organization owners,
organization `ADMIN`s, catalogue managers, content editors, and ordinary users
cannot use it merely by having a product role. The browser-facing page and BFF
admission both rely on the live, bearer-only `GET /api/v1/admin/access` probe:
it returns no identity data and rejects access on the next request after a
demotion. A failed or unavailable probe fails closed.

`SUPER_ADMIN` is not a shortcut for a future product backoffice. Put a
downstream product's admin screens in its own FSD/API area with product roles
and CASL permissions. Do not reuse `app/api/console/**`, the `console` session
audience, or console routes for those screens.

Privileged mutations remain subject to the existing [fresh-auth
boundary](../auth/rbac.md#fresh-authentication-for-dangerous-operations).

## Choose the topology once

AMCore upstream defaults to the localized path topology: `/en/admin` and
`/ru/admin`. A downstream fork chooses once, from the pristine default:

```bash
pnpm init:project --admin-console=disabled
pnpm init:project --admin-console=path --admin-console-slug=control
pnpm init:project --admin-console=host --admin-console-slug=control
```

The optional slug is a validated public page-path segment, not a host name; it
does not change the fixed internal BFF namespace `app/api/console/**`. The
runtime host name is the separate deployment setting
`ADMIN_CONSOLE_HOSTNAME`. In a multi-locale fork, `path` publishes
`/{locale}/{slug}` on the product host and `host` publishes the console at
`/{locale}` on `ADMIN_CONSOLE_HOSTNAME`; the proxy maps that public address to
the physical `/{locale}/{slug}` route. A single-locale fork has no locale
prefix: path mode uses `/{slug}` and host mode uses `/`. In either mode, use
the provided console navigation helpers rather than exposing the physical route
in a public redirect.

The choice is fail-closed and terminal for this scaffold version: repeat,
unchanged-default, drifted, or post-initialization topology/slug changes fail
before writing. Inspect the exact flags and confirmation flow with:

```bash
pnpm init:project --help
```

`disabled` removes only console-owned web routes, UI, BFF/session/login wiring,
generated config, proxy overrides, tests, and console-specific configuration or
docs. It deliberately keeps backend `SystemRole`, `/api/v1/admin/**`,
fresh-auth, audit, health, and metrics foundations for automation or custom
clients. See [project scaffolding](../frontend/brand-theme-and-tokens.md#project-scaffolding)
for the other composable one-time choices.

## Host-mode deployment and session boundary

Host mode is a separate browser trust boundary, not a second URL for the
product session:

- Console login exchanges credentials server-to-server, then admits only a live
  `SUPER_ADMIN` and sets `__Host-amcore_console_session`.
- That cookie is `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, and has no
  `Domain`. Its Redis vault is `web:console-session:v1:*` and every entry has
  `audience: 'console'`.
- Product `amcore_session` / `web:session:v1:*` state is rejected by the
  console, and console state is rejected by product BFF routes. Logout clears
  only console state.
- Login and logout require the exact configured HTTPS console origin through
  `Origin` or `Referer`; missing, malformed, product-origin, or sibling-origin
  requests are denied. This complements, not replaces, `SameSite=Strict`.

Console OAuth is intentionally unsupported. The existing OAuth callback has
one configured frontend origin and cannot establish the console audience; do
not reuse it as a host-login shortcut without a separately reviewed
multi-origin design.

For the reference Caddy deployment, select host mode explicitly:

```bash
CADDY_WEB_DOMAIN="app.example.com" \
ADMIN_CONSOLE_HOSTNAME="console.example.com" \
docker compose -f docker-compose.yml -f docker-compose.console-host.yml up -d
```

The base Caddy profile remains API-only. The host override is the only Caddy
reference that enables the console host; it fails when either hostname is
missing. Nginx users include the matching `docker/nginx/operations-console.conf`
reference. Keep `web` private to the proxy network: do not expose its port to
the public Internet. Both references reject unknown hosts and direct physical
`/{slug}` paths, preserve assets/API/CSP paths, and map only public console
pages and console API paths. The full proxy/TLS tables and direct-container
constraint are in [deployment](../operations/deployment.md#operations-console-host-mode-reference).

## Extending the foundation safely

Keep the current ownership boundaries:

| Concern             | Owned location / rule                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| Route plumbing      | `apps/web/src/app/[locale]/admin/**`; keep it thin and localized                      |
| Page composition    | `apps/web/src/_pages/console/**`                                                      |
| Shell               | `apps/web/src/widgets/console-shell/**`; reuse `shared/ui`, not the product app shell |
| Console BFF         | `apps/web/src/app/api/console/**`; every handler starts with `withConsoleHostGuard()` |
| Live page admission | `requireSuperAdmin()`; do not trust a JWT role snapshot or UI state                   |
| Public navigation   | `RouteProgressLink` and the console public-href helper                                |

For a future panel, first obtain a scoped plan. Add its thin route and page
composition, localized EN/RU copy, and progress-aware navigation. Give every
BFF handler a host guard and every backend data endpoint its own live
`SUPER_ADMIN` authorization; the access probe is admission, not data
authorization. Use the existing graceful-degradation primitives for secondary
data. Add focused unit coverage, a Storybook/a11y state where applicable, and
browser/real-stack coverage for auth, cookies, Redis, or proxy behavior.

Every functional-panel PR must also add or update plain-language
`SUPER_ADMIN` instructions: purpose, visible statuses, actions, dangerous
operations, and failure/degraded behavior. Do not present a planned panel as
available before that PR ships it.

## Verify and troubleshoot

- [Frontend testing](../frontend/testing.md) explains unit, Storybook, browser,
  and real-stack layers. The console Playwright project is invoked by the
  repository-managed harness below so its isolated Compose topology is correct.
- Run `pnpm test:console-session-e2e` for the repository-managed console
  real-stack harness.
- Run `pnpm test:scripts` to prove generated-fork/scaffold transformations; its
  single-locale host proxy smoke validates both nginx and Caddy references.
- Run `pnpm --filter web test:storybook` for component interaction and a11y
  checks, and `pnpm test:observability-contract` after tracked documentation
  changes.

If host mode fails to boot, check that generated config is `host` and that
`ADMIN_CONSOLE_HOSTNAME` is a lowercase FQDN. If a public console URL exposes
the physical slug, or a request reaches `web:3000` directly, correct the proxy
or container network before relying on the deployment.
