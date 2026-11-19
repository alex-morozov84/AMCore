---
name: amcore-admin-placement
description: Change AMCore Console or product administration host, path, alias or enabled mode. Excludes adding screens at unchanged placement and ordinary backend authorization.
---

# AMCore administration placement

Read `PROJECT_CONTEXT.md` and local product instructions. First distinguish the
optional Operations Console from product administration; they have different
settings, entry guards and session audiences.

Read the current selected owner:

- [Console configuration](../../../docs/operations-console/configuration.md)
  and [Console development](../../../docs/operations-console/development.md).
- [Product placement and sessions](../../../docs/product-admin/placement-and-sessions.md)
  and [product integration](../../../docs/product-admin/integration.md).

Use these local contracts before changing host, path, alias or enabled mode.
Adding a tab or page at unchanged placement is not a placement migration.

## Keep one coherent placement

1. Identify the actual source setting, physical route subtree, public addresses,
   generated edge mapping and affected build/runtime inputs. A runtime URL alone
   cannot rename physical routes or change compiled placement.
2. Follow the selected owner's existing validation and generator order. Preserve
   route-group ownership and children; do not leave an unreviewed redirecting copy.
3. Preserve the selected session realm, cookie/Origin/backend context and fail-closed
   admission. A moved URL must not turn a product session into staff or Console
   authority. Operational access still needs its current role and MFA proofs.
4. For disabled Console, retain required source and backend/account-security owners
   while closing its entrypoints. Do not remove unrelated security or domain code.
5. Keep matching source configuration, generated edge and actual deployment artifacts.
   Read the current locale owner if public URL prefixes change. Read installed
   version-matched Next references before affected routing code changes.

## Verify the affected topology

Select checks for the changed host/path/alias/off boundary, direct physical paths,
unknown routes, session isolation and the affected locales. A generated file or
successful build alone does not prove DNS/TLS, ingress policy or a browser journey.
Do not run generators, builds, browser or deployment steps outside task authority.

Report the chosen system, exact source/routes/edge/artifact changes, expected
admission and rollback limits, actual checks and gaps. New backend permissions,
login protocol integration and whole deployment are separate actions; read their
owners only when the task really changes those responsibilities.
