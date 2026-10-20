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
  -f docker-compose.yml -f docker/compose/web.yml up -d
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

The host-mode nginx and Caddy references forward the exact
`/api/deployment-version` path directly to web, without the `/api/console/`
rewrite. This public signal needs no Console session; ordinary Console API
paths keep their existing rewrite. Preserve this exception in a custom edge.

Point DNS for both names at the edge, set both public hosts, and explicitly
enable the profiled edge service. Public Caddy deployments obtain TLS in the
usual Caddy flow; nginx deployments must provide the certificate paths shown in
the reference file.

```bash
CADDY_WEB_DOMAIN="app.example.com" \
ADMIN_CONSOLE_HOSTNAME="console.example.com" \
docker compose --profile edge \
  -f docker-compose.yml -f docker/compose/console-host.yml up -d
```

The base Caddy profile is API-only. Only the host override mounts the console
Caddyfile, and missing hostnames fail validation. For nginx, adapt and include
`docker/nginx/operations-console.conf` with the real domains and certificates.

For HTTPS on a non-default public port, set `ADMIN_CONSOLE_ORIGIN` to the exact
origin, for example `https://console.example.com:8443`. Preserve the complete
public `Host` authority at the edge; the Console guard matches the configured
host and port. A different port or product host is rejected.

Keep `web` private to the proxy network. Do not expose its port publicly. Both
reference proxies reject unknown hosts and direct physical `/{slug}` paths,
preserve assets/API/CSP paths, and map only public console pages and API paths.
See the authoritative [proxy and TLS mapping
tables](../operations/deployment.md#operations-console-host-mode-reference).

## Overview metadata and resource settings

API build identity is generated by the API build command: product version from
the root manifest, compiled-artifact fingerprint and a genuinely available source
commit. CI passes the checkout SHA automatically; local dirty/watch sources do not
claim an exact commit. No per-deploy manual identity entry is required.
Legacy APP_VERSION/APP_COMMIT metrics labels remain separate from artifact facts;
optional runtime labels are not displayed as proof of an environment.

The resource comparison settings are `DATABASE_POOL_MAX`,
`DATABASE_POOL_WAITING_THRESHOLD`, `HEALTH_MEMORY_HEAP_BYTES` and
`HEALTH_DISK_THRESHOLD_PERCENT`. A blank heap setting preserves the existing probe-specific
health defaults: 1 GiB for readiness and 1.5 GiB for liveness. Overview samples only the
responding API process; it does not collect worker resource data. Filesystem
sampling always uses `/` inside that API container.

Build the web artifact with `NEXT_DEPLOYMENT_ID` to supply its ID, or let the
build generate one. Overview shows the compiled ID supplied by the responding
web server; it does not necessarily identify the JavaScript already loaded in a
tab. Setting the
variable on an already built web container does not change it. See
[deployment identity](../operations/deployment.md) for build and rollout behavior.

## External tool links

The [Overview](overview.md) has an **External tools** card with links to the
monitoring tools your team runs. The Console does not install, proxy or embed
them: each link opens the tool in a new tab, and you sign in to the tool
separately. Only a `SUPER_ADMIN` can open the Console, so only a `SUPER_ADMIN`
sees the card. Organization owners and administrators get a not-found page
instead of the Console.

### What AMCore provides and what you deploy

AMCore does not install or run these tools in production. Plan to deploy them
yourself and then set their addresses below.

| Tool    | Provided by AMCore                                                                         | You deploy                                               |
| ------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Metrics | The metrics endpoint, an overview dashboard file, and a dev-only `monitoring` profile      | Your own Prometheus and Grafana                          |
| Alerts  | Alert rules, runbooks and an example Alertmanager setup                                    | Your own Alertmanager and its receivers                  |
| Logs    | Structured log output, and an opt-in overlay that collects and searches it (Loki, Grafana) | The overlay, a log system of your choice, or none at all |

The `monitoring` profile starts Prometheus, Grafana and Alertmanager for local
verification and is never part of the production Compose files. See the
[observability guide](../operations/observability.md) for the dashboard, rules
and runbooks.

### Set the addresses

Set the addresses in the environment of the **web service**. With the bundled
Compose file this is the `web` container, which reads them from the `.env` file
next to `docker-compose.yml`. With another Compose file or platform, set the same
variables in the web container's environment by the means that platform offers.

| Variable                    | Link on the card | Typical target                                   |
| --------------------------- | ---------------- | ------------------------------------------------ |
| `ADMIN_CONSOLE_METRICS_URL` | Metrics          | A Grafana dashboard, such as the AMCore overview |
| `ADMIN_CONSOLE_LOGS_URL`    | Logs             | The log search page of your logging system       |
| `ADMIN_CONSOLE_ALERTS_URL`  | Alerts           | Alertmanager, or Grafana alerting                |

```bash
ADMIN_CONSOLE_METRICS_URL=https://grafana.example.com/d/amcore-overview
ADMIN_CONSOLE_ALERTS_URL=https://alerts.example.com
```

An empty or missing variable means "not configured". Each configured tool is a
link labelled with its name: **Metrics**, **Logs** or **Alerts**. Leave
`ADMIN_CONSOLE_LOGS_URL` empty if you run no log search system: the start-up check
accepts a Grafana address for it, but it cannot know whether that Grafana has a
log data source, and without one the link opens an empty page.

When all three are empty, the card shows the single line "External tools are not
configured." instead of one row per tool. When only some are set, each unset tool
is listed as "not configured". The **How to connect** link, which opens this
section, stays on the card in both cases and disappears only when all three tools
are set.

An address must be an absolute `https` URL with a host name or an IPv4 address; a
port is allowed (`https://grafana.example.com:8443/d/x`). Plain `http` is accepted
only for `localhost` and `127.0.0.1`. IPv6 addresses in brackets are refused. Path,
query and fragment are kept, so a link can open one dashboard. These values are
refused:

- addresses with a user name or password (`https://user:pw@host/`);
- wildcard hosts such as `https://*.example.com`, and relative or scheme-less
  values (`//host/d/x`, `host/d/x`);
- values with spaces or control characters, or longer than 2048 characters;
- other schemes, such as `javascript:` or `ftp:`;
- `http` addresses of any other host, such as `http://grafana.internal:3000`.

A value that is set but refused stops the **web service** at start-up. That is
the whole web application, including the product's own pages, not only the
Console: the process exits and prints the name of the offending variable on
standard error. With the bundled Compose file, read it with
`docker compose logs web`. For the metrics variable the message is:

```text
ADMIN_CONSOLE_METRICS_URL must be an absolute https URL (or a loopback http URL) without credentials, spaces or wildcards
```

Correct the value and start the web service again. A tool that can be reached
only over plain `http` needs TLS in front of it before it can be linked; until
then leave its variable empty.

The Console reads the addresses from the web container's environment while it
serves the page, so a new value needs no rebuild. A container's environment is
fixed when the container is created, so the container must be **recreated** to
receive a new value. With the bundled Compose file, run
`docker compose up -d web`; `docker compose restart web` keeps the old
environment. Then open the Overview and check the card.

For the local `monitoring` profile ([observability guide](../operations/observability.md#local-verification-harness))
you can set:

```bash
ADMIN_CONSOLE_METRICS_URL=http://localhost:3001
ADMIN_CONSOLE_ALERTS_URL=http://localhost:9093
```

These loopback addresses open the tool on the machine of whoever clicks the link,
so they work only in a browser on the same machine as the stack. Compose leaves
all three variables empty by default, so the card never links to a tool that is
not running.

What the card does and does not prove:

- A link means an address is configured. The Console does not contact the tool,
  so it cannot tell whether the tool is running or whether you may sign in. A
  mistyped but valid-looking address, such as a wrong host name, is not detected;
  the link fails when someone opens it.
- A **Logs** link does not prove that log collection is installed. AMCore ships
  log search only as an opt-in overlay; see [Search application logs](../operations/log-search.md).
  A link to its Grafana needs an SSH tunnel to the Docker host.
- Never put a token, API key or password in these addresses, in the path, the
  query or the fragment. The card is shown to every `SUPER_ADMIN`, the address
  appears in the page and in browser history, and the start-up check cannot detect
  a secret in any of those parts.
- The card is part of the Console page. When the API cannot confirm that you are
  a `SUPER_ADMIN`, the Console shows no page content and no links: a
  "temporarily unavailable" notice, or a not-found page when the API is not
  reachable at all. Keep direct bookmarks to your monitoring tools for that case.

The links carry no Console session or token, and the browser sends no `Referer`
to the tool. Single sign-on between the Console and these tools is not provided.

### Find in logs links

Start the [log-search overlay](../operations/log-search.md#install) first. Then the Console can open the log
search for one ID with a **Find in logs** link. Set one more variable in the web service
environment, in the same way as the three above:

```bash
ADMIN_CONSOLE_LOGS_GRAFANA_URL=http://localhost:3002
```

| Question                                 | Answer                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What value do I set?                     | The address of the Grafana from the overlay. It follows the address rules above. A path is allowed (`https://host.example.com/grafana`).                                                                                                                                                                                                                                             |
| Which value with the overlay?            | `http://localhost:3002`. The overlay's Grafana listens on `127.0.0.1` of the Docker host, so the link works only while **your** SSH tunnel is open.                                                                                                                                                                                                                                  |
| Do I also need `ADMIN_CONSOLE_LOGS_URL`? | No. That variable only sets the plain **Logs** link on the Overview card. The two are independent.                                                                                                                                                                                                                                                                                   |
| Can I use my own Grafana?                | Only with a [managed Loki](../operations/log-search.md#use-a-managed-loki-instead): your Grafana needs a Loki data source with the **uid** `amcore-loki` (the name does not matter) that reads that Loki. The overlay's own Loki publishes no port and allows no other service on its network, so with the overlay use the overlay's Grafana. A different uid opens an empty search. |
| Can the address use plain `http`?        | Only for `localhost` and `127.0.0.1`. For any other host use `https`, for example behind a reverse proxy.                                                                                                                                                                                                                                                                            |
| What if it is empty?                     | No **Find in logs** links appear and nothing else changes. When **Logs** is set, the card says "Log links on jobs and audit events: not configured."                                                                                                                                                                                                                                 |

Where the links appear:

| Screen                                          | ID that is searched                           |
| ----------------------------------------------- | --------------------------------------------- |
| [Background work](background-work.md) job cards | The job, delivery or run ID shown on the card |
| [Audit](audit.md) command details               | The task ID                                   |
| [Audit](audit.md) event                         | The request ID, when the event has one        |

Each link opens Grafana in a new tab and runs `{service=~"api|worker"} |= "<ID>"` over the last
7 days, the default retention of the overlay. If your retention is longer, widen the time range in
Grafana. What a search finds:

- The link searches the `api` and `worker` services. The `web` service has its own lines; search
  them by hand ([Find a request](../operations/log-search.md#find-a-request)).
- A queued job: the API line that queued it and the worker lines of its run.
- A notification delivery or an AI run: only the lines that the worker logged with that ID. Many
  deliveries log only failures, so an empty result does not mean the delivery did not happen.
- A request ID: all API and worker lines of that request. The ID is a search aid that the caller can
  choose; it does not prove who made the request.
- An ID older than the retention, or a line that was never logged: no result. Grafana then shows an
  empty list; check [what is lost and kept](../operations/log-search.md#what-fails-and-what-is-lost).

If a link does not work, check in this order:

1. **Connection error.** The SSH tunnel to the Grafana is not open, or it uses another port than the
   address. The overlay's Grafana is not running (`docker compose ps logs-grafana`). The address has a
   typo. The `web` container was restarted, not recreated, after you set the variable.
2. **Grafana asks for a login.** Sign in with its own user; the Console sends no credentials.
3. **An empty list.** The ID is older than the retention (7 days by default), the line was never
   logged, or the data source uid is not `amcore-loki`. Check the pipeline with a fresh request
   ([Find a request](../operations/log-search.md#find-a-request)).

The Console only builds the address. It sends no token or session, and Grafana asks for its own login.
A set but unusable value stops the web service at start-up with the variable's name, like the
addresses above; recreate the container to apply a new value: run `docker compose up -d web` with the same `-f` files that you use to start the stack (for the production setup with the overlay: `docker compose -f docker-compose.yml -f docker/compose/prod.yml -f docker/compose/logs.yml up -d web`). Only IDs
made of letters, digits and `. _ : -` get a link.

### Documentation links

The **Recovery instructions** link is always shown. It opens the
`docs/operations/runbooks` folder of the upstream repository,
`https://github.com/alex-morozov84/AMCore`, on GitHub. The **How to connect**
link and the guide links on the Background work and Overview storage screens use
the same base. The base is not an environment variable: it is the constant
`DOCS_REPOSITORY_URL` in `apps/web/src/shared/lib/console-docs-links.ts`, so
changing it needs a rebuild of the web image (with the bundled Compose file,
`docker compose build web`, then `docker compose up -d web`). Every address
points to the `main` branch, which can be newer than the version you deployed, so
a guide may describe behavior your deployment does not have yet.

The constant holds a repository root, such as `https://github.com/your-org/your-repo`.
The functions `docsPageHref` and `docsFolderHref` in the same file build each
address as `<root>/blob/main/<page path>` for a page and
`<root>/tree/main/<folder path>` for a folder. A fork that keeps its
documentation in a GitHub repository changes only the constant. A documentation
site with a different path scheme, such as `https://docs.example.com`, also needs
those two functions changed.

## Database prerequisite: `pg_trgm` (Users/Organizations search)

The Users and Organizations panels' search (ADR-082) is backed by
PostgreSQL's `pg_trgm` extension. The console's own migration installs it
(`CREATE EXTENSION IF NOT EXISTS pg_trgm`) — it is a PG13+ _trusted_
extension, installable by any role with `CREATE` on the target database,
no superuser grant required, and ships in the stock `postgres` Docker
image this project runs by default. If you follow [Production Database
Role Separation](../operations/database-role-separation.md), this means
the migration-only `amcore_migrator` role can install it; the runtime
`amcore_runtime` role neither installs nor owns it and only ever queries
through the resulting indexes.

If you deploy against a managed Postgres provider, confirm it specifically
allows `pg_trgm` **before** running migrations against it — it is a
commonly allowlisted contrib extension, but "commonly" is not a
guarantee for your specific provider and plan tier. A provider that
disallows it must fail the migration visibly; there is no supported
fallback that silently serves search without the index it depends on.

## Console URLs in browser history and logs

Users and Organizations searches put the entered name, email, or slug in the
page URL. Audit URLs contain exact actor, target, and organization filter IDs
and an encrypted page cursor. The cursor hides its internal anchor and contains
no raw audit-row ID. Audit current-name lookup text is sent in a same-origin
POST body and stays out of URL history. Treat all of these URL values as
operator input that may reveal personal or organizational information:

- **The browser address bar and history**, on whichever machine the
  operator is using. These views can be reloaded, bookmarked, or shared;
  review the URL before pasting it into a chat or ticket.
- **This API's request access logs and exception path fields** redact search
  terms and audit ID/cursor values in structured query and URL fields.
  Error-response paths are redacted too.
- **A reverse-proxy access log** (Caddy, nginx, or any edge proxy in
  front of either topology — **path mode and host mode alike**) is
  outside this application's runtime and is not redacted by the shipped
  reference configs. If your deployment retains proxy access logs and
  that matters for your privacy posture, configure your proxy's own log
  format to omit or truncate query strings for console routes.

## Queue board

The [queue board](queue-board.md) is opened from Background work through a fixed bridge in
the Console's own server; it has no setting of its own besides the API's `ENABLE_BULL_BOARD`.

- **Address.** Path mode serves it at `/api/console/bull-board/` on the product host. Host mode
  serves it at `/api/bull-board/` on the Console host: the reference nginx and Caddy
  configurations already map `/api/*` to `/api/console/*` there, so the board needs no extra rule.
  The mapping must rewrite only the leading `/api/`, because the board's own data paths
  (`/api/bull-board/api/queues`) contain a second one; the references do (anchored in nginx,
  `uri replace … 1` in Caddy), and the board's root `/api/bull-board/` is mapped to the slashless
  physical route by an explicit rule in both (otherwise Next.js's own trailing-slash redirect would
  expose `/api/console/`). Keep both, and no caching, in a custom edge.
- **Enabling.** In production set `ENABLE_BULL_BOARD=true` in the environment of the API process
  and restart it; `.env` cannot enable it. The board is never served by the `worker` role.
  Enabling it does not allow any action.
- **What reaches the API.** The bridge reaches only the board's own mount
  (`/api/v1/admin/queues`) with your Console session's bearer token. It forwards only `GET` and
  `HEAD`, checks the path and the four query keys the board uses, drops every browser cookie and
  header except a few, follows no redirect and serves nothing that does not carry the board's own
  security policy. The generic product proxy refuses that path.
- **Session.** In host mode the Console's own session is used and the product session is not
  accepted; in path mode the product session is used, as for every other Console route. A
  `SUPER_ADMIN` demotion applies on the next request; revoking the API session from elsewhere can
  take up to the access token's lifetime (see [who can open it](queue-board.md#who-can-open-it)).

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
- Background work says the queue board is not enabled: see
  [Enabling the board](queue-board.md#enabling-the-board). If it says it could not be opened,
  check that the API is reachable from the web server and that nothing caches or rewrites
  `/api/bull-board/` (host mode) or `/api/console/bull-board/` (path mode).
