# Product administration foundation

AMCore supplies an Organizations selector and read-only organization overview for
signed-in members, explicit self-service organization creation when enabled, plus a [members and role-assignment page](organization-members.md)
and [invitation management](invitations.md) for members with full TeamAccess.
The Members page also provides [confirmed removal with permanent key revocation](organization-members.md#remove-a-member).

This product surface is independent of the [Operations Console](../operations-console/README.md), which is restricted to
platform super-administrators. An organization role does not grant Console access.

The default path-mode pages are `/manage/organizations` and `/manage/organizations/[id]`, with `/en` or
`/ru` prefixes in multi-locale builds. The selector displays memberships, opens a
single membership automatically, and paginates multiple memberships in groups of 20. **All organizations** returns to `?view=list`, preserving list access even
with one membership. The overview confirms organization, account and team-access
capability. The “Your access” card reports only the verified team-access decision;
it does not infer permissions for individual records. It does not provide organization editing. Custom roles are managed on the ready **Roles** tab
(see [role definitions](role-definitions.md#ready-role-screens)), built on the
[role definitions API](role-definitions.md) (atomic complete-definition save, holders and
impact, confirmed delete), which is also available for a downstream editor. The Members tab adds an
**Access** view that explains what a member can do and which roles give or block it
([member access explanation](member-access.md)). The
Invitations section provides creation, search, repeat/replace and revocation;
recipients use a separate sign-in, verification and explicit-consent journey.
See the [invitation API](../auth/invites.md) for contracts and upgrade requirements. See the
[capability catalogue and access hints](../auth/capability-catalogue.md) for the
separate discovery, actor and record contracts.

[Organization establishment](organization-establishment.md) covers independent signup/creation
policies, trusted first-ADMIN setup, the production command, Console controls and
recovery. Registration alone never creates staff membership. Unresolved creation
recovery takes priority over automatic opening of a single membership.

For a complete fork setup, three product recipes and custom visual styling, use
[Add product administration to your product](adoption.md). Initialize identity and
project choices before generating consumers.

## Connect the ready pages

Choose the public path alias or separate admin host with the
[placement and sessions guide](placement-and-sessions.md). Path mode shares the
website session; host mode isolates staff login. The default login is
`/ru/manage/login`; a separate admin host exposes `/ru/login`.

The ready routes, menus, recovery, invitations and email destinations use that
source placement. The sidebar keeps icons when collapsed and places the website
link at the bottom. The header retains the
[account menu with profile and avatar editing](account-menu-and-profile.md).

See [integration](integration.md) for custom-shell, nonhierarchical and headless
composition. `--admin-console` affects only the Operations Console. Product admin
placement uses its own checked source and physical routes, with no new initializer flag.

## Authority, state and customization

The API verifies current membership and permissions. UI capability text is an
interaction affordance, never authorization. Selecting a company does not change
session or exchange credentials. Missing/inaccessible organizations stay at the
requested URL; no other membership is silently adopted.

Pending, denied, missing-session, changed-session and transport-error states hide
old organization data. Missing session offers sign-in; a changed login offers
Reload. Refresh rereads current context; infrastructure errors are not empty lists.
An already admitted request or committed write may finish after a permission
change. This foundation does not supply emergency session revocation. Independent staff
sessions require the separate-host placement described above. See the [API contract](../auth/organization-context.md) and
[ordered UI lifecycle](../frontend/organization-context.md).

Ready UI is ordinary editable JSX using semantic tokens, shared primitives and
optional CSS Modules. Keep translations in every catalogue. Custom presentation
uses the public headless API without importing ready pages or a shell; keep its
request/session lifecycle shared. The [extension guide](extending-modules.md)
describes ownership and the acceptance checklist for later modules.

[Operator organization provisioning](organization-provisioning.md) creates an organization for another person and invites its first ADMIN. It supports Console-disabled API use and recovery without duplicate organizations.

- [Add and recover organization administrators](organization-administration.md): current ADMINs, additional invitations, member assignment and no-Console recovery.

[Member API keys](member-api-keys.md) adds safe inventory and explicit single/all
revocation through the member menu. Supported backend member removal permanently
revokes organization keys through the confirmed Members removal flow.

[My API keys](own-api-keys.md) adds personal creation, one-time secret handling and all-organization owner cleanup.
