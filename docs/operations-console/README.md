# Operations Console

The Operations Console is AMCore's optional system control plane for platform
super-administrators. The shipped foundation provides a protected, localized
Control Room shell, live access admission, and isolated host-mode login/logout.
It does not yet provide health, metrics, users, organizations, queues, audit, or
AI control panels.

It is not a product backoffice. Organization owners, organization `ADMIN`s,
catalogue managers, content editors, and ordinary users do not gain access from
their product role. Build product administration in a separate product-owned
area with its own roles and permissions.

## What a super-administrator can use today

After admission, the console shows:

- the localized Control Room shell;
- one **Overview** navigation item;
- an access-policy strip; and
- a placeholder confirming that the foundation is ready.

The access-policy strip describes the protection around the console. It is
**not** a live health, queue, metrics, or alert reading. No operational action
is available yet.

## Before signing in

The account must already have `SystemRole.SUPER_ADMIN`. There is no
self-promotion or first-admin screen. Follow [Administering
`SUPER_ADMIN`](../auth/rbac.md#administering-super_admin) for the authenticated
admin API and the one-time database bootstrap procedure.

Only `SUPER_ADMIN` is admitted. The console checks the current database role
through the bearer-only `GET /api/v1/admin/access` probe and returns no identity
or permission data. Demotion takes effect on the next protected request; a
failed or unavailable probe fails closed.

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
the access service is unavailable. Treat that response as a closed security
boundary, not proof that the configured route cannot exist.

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
