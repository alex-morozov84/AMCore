# Manage and accept organization invitations

The reference pages include an **Invitations** section at
`/organizations/[id]/invites` (`/en` or `/ru` prefix in multilingual builds).
Open Organizations, select an organization, then Invitations. Management requires
current membership and unrestricted `manage:TeamAccess`; a platform super-admin
without that organization access cannot manage its invitations.

## Invite someone

Use **Invite** in the search toolbar (on small screens it wraps below search), enter the email and select roles. `MEMBER` is selected by
default. For example, select `MEMBER` and your custom `Analyst` role to give the
recipient both roles upon acceptance. Role badges expose descriptions by hover
or keyboard focus. Search role choices without losing earlier selections; select
1–20 roles. The selected set is complete, even when choices span multiple pages.

Submit once. After confirmed success the dialog closes, the list refreshes and
its actions become available. The success message confirms processing, not email
delivery or the existence of an account. Inviting an existing member leaves their
access unchanged and sends no invitation email.

While the current list is being checked, dependent actions and open confirmations
are blocked; your unsaved role selection stays intact. A failed primary list read
hides cached rows and displays a localized retry action. Cancel stays available.
A role-choice failure blocks selection but leaves the independent list/revoke path
usable. A successful current read is required before acting again.

Filter Pending, Expired or All, or search by email. Search/pagination are reflected
in the URL. Pending is the default. Expired invitations remain listed for 30 days
after expiry; accepted and revoked invitations leave the visible list.

## Repeat, change roles or revoke

Open the row's **Actions** icon menu to resend, change roles or revoke. The same
menu is available on mobile cards and with the keyboard; closing a confirmation
returns focus to its trigger when that row is still available.

**Resend** retains the entire issued role set. **Change roles and resend** replaces
it with the complete new selection. Both require confirmation that the previous
link will stop working, create a new seven-day deadline and close the dialog after
confirmed success. A deleted role is retained as issued intent but cannot be
repeated: choose a complete valid replacement. Current permissions of live roles
apply; invitation roles do not freeze a historical permission snapshot.

**Revoke** asks for confirmation and invalidates the invitation. It does not
remove an existing member or delete an account. Use Members to manage access.
If another manager changed the invitation, refresh and review its current
version before deciding again; do not silently submit the old selection.

## Follow the recipient link

1. Open the original email link. Sign in with the invited account or register
   with its fixed email. Password fields support show/hide. An incorrect password
   shows an error and allows retry once the current invitation state is synchronized.
   A rate-limit rejection also synchronizes the state; wait as instructed before
   submitting again. A lost response requires recovery before another submission.
2. Verify email if requested. Email verification itself does not sign you in or
   join the organization. If verification opens another tab, return to the
   invitation tab and check verification, or reopen the original email link.
3. Review the organization, complete role set and confirmation deadline, then
   explicitly choose **Accept invitation**. This is the only step that joins.
4. Open the organization after success. If access already existed, existing roles
   remain unchanged. Leaving the screen does not revoke an invitation.

A different signed-in account gets a switch-account action before private
organization/role details are shown. An expired, revoked or superseded link cannot
join. Ask the manager for a fresh invitation. The original email URL can be opened
in another browser; the later flow address requires that browser’s cookies and
cannot transfer authority to another device. The confirmation window lasts at
most 30 minutes and may end before the invitation’s seven-day deadline. Reopen the
original email when instructed. Password reset revokes sessions: sign in again
and reopen the link.

`AUTH_PUBLIC_SIGNUP_ENABLED=false` closes ordinary email and new-account OAuth
signup while allowing existing-account login and valid invitation registration.
The server enforces this policy; hiding UI is insufficient. Invited OAuth must
match the invitation email and the configured provider verification rules.

## When the connection or permissions change

Loading uses structural skeletons; role-choice search preserves the form draft.
Mobile layouts use cards instead of the wide table. Keyboard controls, localized
errors and reduced-motion placeholders apply in both languages.

A timeout may follow a committed write. **Recover** checks the same operation;
it does not start a different invitation or acceptance. Unknown means the result
is unresolved, not rolled back. A successful write followed by a failed refresh
remains successful; **Review current state** refreshes authority/list before
another command. Lost sign-in acknowledgment has its own recovery action: do not
submit credentials again while their issuance is uncertain.

Current authority is checked again for operations. Session replacement or loss
hides stale protected data and requires recovery/sign-in. Disabled browser storage
permits in-memory recovery but limits recovery after reload. Accepted-operation
proofs remain available for 30 days; recovery reports removed access without
rejoining. See [API limits, security and recovery](../auth/invites.md).

## Reuse with your own design

The ready route uses `OrganizationInvitationsMount` from
`@/_app/organization-access/index.server`. Organization placement derives its
Invitations link, but moving placement still requires matching physical routes.
`OrganizationInvitationsClient` from `@/_pages/organization-invitations` supplies
reference page composition; `InvitationForm` from `@/features/invitation-management`
is independently replaceable form presentation.

For a different table/form, import `useOrganizationContext`,
`useOrganizationInvitations`, `useInvitationRoleChoices` and
`useInvitationManagerOperations` from `@/entities/organization-context`.
Keep one parent context owner and pass its controller to the three invitation
hooks. The operation controller/journal outlives an individual dialog. Keep dirty
selection separate from paginated choices, retain expected generation, and render
committed/rejected/unknown/expired/retired plus follow-up status truthfully.
Do not create a fresh command after an unknown outcome.

Recipient transport and journals live in `@/entities/invitation-flow`; optional
ready forms/status/consent and application credential adapters are documented in
[custom invitation forms](integration.md#custom-invitation-forms). Presentation
replacement does not remove server cookie binding, separate sign-in acknowledgment,
verification or explicit consent. Shared role badges, role choices, search fields,
password input, skeletons and dialogs contain no Console authority dependencies.

The browser uses dedicated `/api/product-access` and `/api/invitation-flows`
adapters. Do not put bearer/refresh/continuation secrets in browser storage or
component props, or route invitations through the generic API proxy. Installation
upgrades must drain old writers and deploy the matching migration/application;
see [controlled upgrade](../auth/invites.md#upgrade-an-existing-installation).

## Project choices

Invitation management and recipient forms remain available when the optional
Operations Console is disabled. A single-locale project uses prefixless routes:
for example, `/organizations/<organization-id>/invites` and `/invite/accept`.
Disabling Storybook removes component stories, while ready screens and headless
controllers remain usable. Disabling route progress keeps navigation working
without the top progress bar.

For example, a Russian-only fork with these choices runs the initializer after
brand setup:

```sh
pnpm init:project --mode=single --locale=ru --admin-console=disabled --storybook=disabled --route-progress=disabled
```

Some choices move or delete files. Follow the
[project scaffolding guide](../frontend/brand-theme-and-tokens.md#project-scaffolding)
before applying them to a fork. Custom presentation still uses the same
invitation permissions, recovery and recipient consent contract.
