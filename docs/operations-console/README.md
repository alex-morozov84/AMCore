# Operations Console

The Operations Console is AMCore's optional system control plane for platform
super-administrators. The shipped foundation provides a protected, localized
Control Room shell, live access admission, and isolated host-mode login/logout.
It ships three functional panels, **Overview** (this API instance's readiness,
version, and process role), **Users** (read-only), and **Organizations**
(read-only). It does not yet provide metrics, queues, audit, or AI control
panels.

It is not a product backoffice. Organization owners, organization `ADMIN`s,
catalogue managers, content editors, and ordinary users do not gain access from
their product role. Build product administration in a separate product-owned
area with its own roles and permissions.

## What a super-administrator can use today

After admission, the console shows:

- the localized Control Room shell;
- three navigation items, **Overview**, **Users**, and **Organizations**;
- a header showing the signed-in operator's identity, a language switcher
  (hidden on a single-locale fork), and, in host mode, a sign-out control.

**Overview** shows this API instance's readiness (reusing the same checks as
`/health/ready`), a sanitized per-dependency up/down/unknown state, the app
version, and the process role (`web`/`worker`/`all`). A successfully
_observed_ degraded instance is not an error: the panel shows an
**"API instance not ready"** notice naming the affected dependencies, still
as ordinary page content. Only a real failure to reach the Overview endpoint
itself (network error, timeout, an actual server error) shows the generic
"temporarily unavailable" state described below for Organizations — the two
are deliberately kept visually and semantically distinct, so a console
operator never mistakes "the console can't reach its own backend" for "the
backend told us its dependency is down."

**Organizations** lists every organization in the system: name, slug, and
created/updated timestamps, paginated. It is **read-only** — there is no way
to create, edit, delete, or otherwise act on an organization from this panel,
and no per-organization detail view (the backend has no such endpoint yet).
If the panel cannot reach its data (the backend is unreachable, times out, or
returns an unexpected error), it shows a plain "temporarily unavailable"
message with a retry button — it never silently shows an empty list in place
of a real failure. An empty list (with no failure) means the system genuinely
has no organizations yet, which is expected on a fresh installation.

**Users** is a paginated platform-user inventory. It shows each user's name
and email, email-verification state, current system role, last sign-in, and
created/updated timestamps. It is **read-only**: it does not expose a detail
page, profile fields, sessions, account recovery, deletion, or any role change.
It has the same explicit unavailable and genuine-empty states as Organizations.
Changing a system role remains deliberately out of scope until its separate
fresh-authentication and durable session-revocation security contract is ready.

## Before signing in

The account must already have `SystemRole.SUPER_ADMIN`. There is no
self-promotion or first-admin screen. Follow [Administering
`SUPER_ADMIN`](../auth/rbac.md#administering-super_admin) for the authenticated
admin API and the one-time database bootstrap procedure.

Only `SUPER_ADMIN` is admitted. The console checks the current database role
through the bearer-only `GET /api/v1/admin/access` probe and returns no identity
or permission data. Demotion takes effect on the next protected request. An
absent or denied session, a session-vault/network failure, or an unexpected
probe response remains a not-found response. Only an explicit `503` response
from that upstream probe shows the generic unavailable state, with no console
shell, identity, or data.

## Sign in and out

The public address depends on the topology selected when the downstream fork
was initialized:

- **Path mode:** sign in through the product's normal localized login, then
  open `/{locale}/{slug}`. AMCore's upstream examples are `/en/admin` and
  `/ru/admin`.
- **Host mode:** open
  `https://<ADMIN_CONSOLE_HOSTNAME>/{locale}/login`, or `/login` in a
  single-locale fork, and enter the platform administrator's email and password.
  A product login on another host does not sign the browser into the console.

In host mode, use the shell's **Sign out** action to revoke and clear only the
console session. It does not sign the user out of the product application.
Console OAuth is not currently supported.

The protected console deliberately responds as not found when admission fails,
including when the session is absent, the current role is not `SUPER_ADMIN`, or
the console cannot determine admission safely. An explicit upstream `503` is
the narrow exception and renders the generic unavailable state without console
chrome. Treat either response as a closed security boundary, not proof that the
configured route cannot exist.

## Configure, deploy, or extend it

- [Configuration and deployment](configuration.md) — choose `disabled`, path,
  or host mode; set the slug and hostname; understand the separate host session;
  deploy through Caddy or nginx; troubleshoot routing.
- [Development and extension](development.md) — code ownership, authorization
  rules, adding a future panel, documentation obligations, and verification.
- [Authentication and sessions](../auth/README.md) — the wider identity, RBAC,
  CSRF, session, and step-up contracts.
- [Production operations](../operations/README.md) — the complete deployment
  and operational documentation map.

## Documentation contract for future panels

Every functional-panel PR must update this user guide or add a linked page that
plainly explains the panel's purpose, visible statuses, available actions,
dangerous operations, and failure or degraded behavior. A planned panel must
never be presented as available before it ships.
