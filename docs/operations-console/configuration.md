# Operations Console Configuration and Deployment

Start with the [Operations Console user guide](README.md) for the capability and
access boundary. This page covers downstream initialization and deployment.

## Choose the topology once

AMCore upstream defaults to localized path mode at `/en/admin` and `/ru/admin`.
A downstream fork chooses once from the pristine default:

```bash
pnpm init:project --admin-console=disabled
pnpm init:project --admin-console=path --admin-console-slug=control
pnpm init:project --admin-console=host --admin-console-slug=control
```

The optional slug is a validated page-path segment, not a hostname, and never
changes the fixed internal BFF namespace `app/api/console/**`. The public
hostname is the separate deployment setting `ADMIN_CONSOLE_HOSTNAME`.

| Fork shape    | Path mode public page | Host mode public page                           |
| ------------- | --------------------- | ----------------------------------------------- |
| Multi-locale  | `/{locale}/{slug}`    | `https://<hostname>/{locale}`                   |
| Single-locale | `/{slug}`             | `https://<hostname>/` (no public physical slug) |

The choice is fail-closed and terminal in scaffold v1. Repeated,
unchanged-default, drifted, or post-initialization topology/slug changes fail
before writing. Inspect flags and confirmation behavior with:

```bash
pnpm init:project --help
```

`disabled` removes console-owned web routes, UI, BFF/session/login wiring,
generated configuration, proxy overrides, tests, and this documentation. It
keeps backend `SystemRole`, `/api/v1/admin/**`, fresh-auth, audit, health, and
metrics foundations for automation or custom clients. The other composable
choices are documented under [project
scaffolding](../frontend/brand-theme-and-tokens.md#project-scaffolding).

## Path-mode deployment and session

Path mode needs no `ADMIN_CONSOLE_HOSTNAME` and creates no separate console
cookie. It uses the product host, the normal product login, and the existing
`amcore_session` BFF vault; the live `SUPER_ADMIN` probe remains an additional
admission check.

For the bundled product-web Caddy reference, set the product host and enable the
profiled edge service:

```bash
CADDY_WEB_DOMAIN="app.example.com" \
docker compose --profile edge \
  -f docker-compose.yml -f docker-compose.web.yml up -d
```

The console is then available under the selected localized or single-locale
slug on that host. A bring-your-own proxy serves the same application normally;
it needs no host-to-physical-slug mapping in path mode.

## Host-mode session boundary

Host mode is a separate browser trust boundary:

- Credential login admits only a live `SUPER_ADMIN` and sets
  `__Host-amcore_console_session`.
- The cookie is `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, and has no
  `Domain`.
- Its Redis vault uses `web:console-session:v1:*`; every entry has
  `audience: 'console'`.
- Product `amcore_session` / `web:session:v1:*` state is rejected by the
  console, and console state is rejected by product BFF routes.
- Login and logout require `Origin` or `Referer` to match the exact configured
  HTTPS console origin. Missing, malformed, product, or sibling origins fail.

OAuth is intentionally unsupported because the existing callback has one
frontend origin and cannot establish the console audience. It needs a separate
multi-origin design before it can be added safely.

## Reference Caddy deployment

Point DNS for both names at the edge, set both public hosts, and explicitly
enable the profiled edge service. Public Caddy deployments obtain TLS in the
usual Caddy flow; nginx deployments must provide the certificate paths shown in
the reference file.

```bash
CADDY_WEB_DOMAIN="app.example.com" \
ADMIN_CONSOLE_HOSTNAME="console.example.com" \
docker compose --profile edge \
  -f docker-compose.yml -f docker-compose.console-host.yml up -d
```

The base Caddy profile is API-only. Only the host override mounts the console
Caddyfile, and missing hostnames fail validation. For nginx, adapt and include
`docker/nginx/operations-console.conf` with the real domains and certificates.

Keep `web` private to the proxy network. Do not expose its port publicly. Both
reference proxies reject unknown hosts and direct physical `/{slug}` paths,
preserve assets/API/CSP paths, and map only public console pages and API paths.
See the authoritative [proxy and TLS mapping
tables](../operations/deployment.md#operations-console-host-mode-reference).

## Troubleshooting

- Startup fails in host mode: confirm the generated mode is `host` and
  `ADMIN_CONSOLE_HOSTNAME` is a lowercase FQDN.
- Caddy is absent after `compose up`: confirm `--profile edge` was supplied.
- A public redirect exposes the physical slug: stop relying on the deployment
  and correct the proxy mapping.
- `web:3000` is publicly reachable: close the port or firewall exception; host
  validation assumes the proxy and private container network are the boundary.
- A valid account receives not found: verify it has the current
  `SystemRole.SUPER_ADMIN` and that the API access probe is reachable.
