# Operations Console

The Operations Console is AMCore's optional control plane for platform
super-administrators. It is separate from a product's own administration area:
an organization owner or administrator does not gain Console access through
their organization role.

## Contents

| Screen                            | Use it to                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------- |
| [Overview](overview.md)           | Check this API instance's readiness, dependencies, version, and process role. |
| [Users](users.md)                 | Find users, inspect their details and memberships, and change system roles.   |
| [Organizations](organizations.md) | Inspect organizations, members and their roles without changing them.         |
| [Audit](audit.md)                 | Browse recent system events and narrow them by action, identity, or time.     |

The Console also has a [configuration and deployment guide](configuration.md)
for operators who set it up and a [development guide](development.md) for teams
adding panels. The [persistent audit log guide](../operations/audit-log.md)
describes how events are recorded and protected across the application; the
[Audit screen guide](audit.md) explains how to browse them.

## Get access

Your account must already have the platform `SUPER_ADMIN` system role. There is
no first-admin or self-promotion screen. A current `SUPER_ADMIN` can change a
user's role in [Users](users.md#change-a-users-system-role); the first admin is
created through the [bootstrap procedure](../auth/rbac.md#administering-super_admin).
Organization roles alone do not grant access.

The sign-in address depends on how the Console was configured:

- **Path mode:** Sign in through the product's normal login, then open its
  Console path. In the upstream multi-locale setup, use `/en/admin` or
  `/ru/admin`.
- **Host mode:** Open `https://<ADMIN_CONSOLE_HOSTNAME>/{locale}/login`, or
  `/login` on a single-locale fork, and sign in with your email and password.
  A product login on another host does not sign you into the Console. Use
  **Sign out** in the Console to end only its session. Console OAuth sign-in
  is not supported.

The protected Console shows a not-found response if access is absent or denied.
If its access check explicitly reports a service outage, it shows an
unavailable state instead. A `SUPER_ADMIN` demotion takes effect on the next
protected request. See [configuration and deployment](configuration.md) for the
session and routing details.

## Scope

The Console has the four areas above, with full user and organization detail
pages accessible from the lists and from current identities in Audit. It has
no metrics, queues, or AI control panels. Product administration belongs in a
separate area with its own roles and permissions.
