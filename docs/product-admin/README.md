# Product administration foundation

AMCore supplies an Organizations selector and read-only organization overview for
signed-in members, plus a [members and role-assignment page](organization-members.md)
and [invitation management](invitations.md) for members with full TeamAccess.

This product surface is independent of the [Operations Console](../operations-console/README.md), which is restricted to
platform super-administrators. An organization role does not grant Console access.

The default pages are `/organizations` and `/organizations/[id]`, with `/en` or
`/ru` prefixes in multi-locale builds. The selector displays memberships, opens a
single membership automatically, and paginates multiple memberships in groups of 20. **All organizations** returns to `?view=list`, preserving list access even
with one membership. The overview confirms organization, account and team-access
capability. The “Your access” card reports only the verified team-access decision;
it does not infer permissions for individual records. It does not provide organization editing or role-definition editing. The
Invitations section provides creation, search, repeat/replace and revocation;
recipients use a separate sign-in, verification and explicit-consent journey.
See the [invitation API](../auth/invites.md) for contracts and upgrade requirements. See the
[capability catalogue and access hints](../auth/capability-catalogue.md) for the
separate discovery, actor and record contracts.

## Connect the ready pages

Application composition owns one placement in
`apps/web/src/_app/organization-access/model/placement.ts`:

```ts
export const organizationAccessPlacement: OrganizationAccessPlacement = Object.freeze(
  normalizePlacement({
    organizationsPath: '/manage/organizations',
    homeHref: '/',
  })
)
```

Wire the matching physical Next list and `[id]` routes. The mount, both product
menus, pagination, selected links, explicit-list return and shell/empty-list home
links use this placement automatically. No href builders or router callbacks are
required. The Sessions route remains independent at `/settings/sessions`.
Server admission and the standard client missing-session link both use `/login`.
Placement does not relocate login or implement a return-after-login journey.

See [integration](integration.md) for route/layout/error wiring, a custom-shell
ready mount, explicit nonhierarchical routes and a CRM headless block. Configure
brand and project initialization choices **before** moving downstream routes.
`--admin-console` affects only the Operations Console; it does not remove or
configure product administration. This is an editable source integration recipe,
not an initializer option or automatic host/path deployment system.

## Authority, state and customization

The API verifies current membership and permissions. UI capability text is an
interaction affordance, never authorization. Selecting a company does not change
session or exchange credentials. Missing/inaccessible organizations stay at the
requested URL; no other membership is silently adopted.

Pending, denied, missing-session, changed-session and transport-error states hide
old organization data. Missing session offers sign-in; a changed login offers
Reload. Refresh rereads current context; infrastructure errors are not empty lists.
An already admitted request or committed write may finish after a permission
change. This foundation does not supply emergency session revocation or independent
staff sessions. See the [API contract](../auth/organization-context.md) and
[ordered UI lifecycle](../frontend/organization-context.md).

Ready UI is ordinary editable JSX using semantic tokens, shared primitives and
optional CSS Modules. Keep translations in every catalogue. Custom presentation
uses the public headless API without importing ready pages or a shell; keep its
request/session lifecycle shared. The [extension guide](extending-modules.md)
describes ownership and the acceptance checklist for later modules.
