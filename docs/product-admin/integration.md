# Integrate organization pages and custom UI

Initialize your downstream identity with `pnpm init:brand`, then apply any chosen
`pnpm init:project` dimensions before manual route movement. Inspect the resulting
route tree: examples below use multi-locale `[locale]`; single-locale builds omit
that segment. Use nonreserved same-host destinations that do not overlap API,
authentication, assets or Operations Console routes.

## Ordinary placement

Change `organizationAccessPlacement` once as shown in the
[entry guide](README.md#connect-the-ready-pages). `organizationsPath` is a
locale-neutral, nonroot absolute path with literal `[A-Za-z0-9_-]+` segments;
`homeHref` uses the same syntax or `/`. A single trailing slash is normalized at the application source and when deriving
destinations, including the home destination. Queries,
hashes, encoded paths, dot/empty segments, backslashes and external URLs are
unsupported. This bounded adapter does not validate all route or deployment
collisions. Use the explicit page API for other destinations.

Move the existing `(organization-access)/organizations/` directory to
`(organization-access)/manage/organizations/`. Keep its ancestor layout and error
boundary; route groups do not contribute URL segments. Supply actual physical
pages; a placement descriptor does not create routes.

The list page stays a thin server entry:

```tsx
import { OrganizationAccessMount } from '@/_app/organization-access/index.server'

export const dynamic = 'force-dynamic'
export default OrganizationAccessMount
```

The selected page awaits its route parameter:

```tsx
import { OrganizationAccessMount } from '@/_app/organization-access/index.server'

export const dynamic = 'force-dynamic'
export default async function SelectedOrganization({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <OrganizationAccessMount id={(await params).id} searchParams={searchParams} />
}
```

The ancestor layout may keep `OrganizationAccessFrame` from the compatibility
`@/_app/organization-access` entry. It renders AppShell. The ready server mount's
`index.server` entry has no AppShell dependency, so a downstream can instead wrap
it with its own server composition and shell. Keep an error boundary that renders
safe recovery for failed infrastructure reads. The page retains its own admission
check; a layout alone is insufficient as an authentication gate.

The dashboard layout reads the same `index.config` placement for home and imports
its Organizations menu from `index.client`. The organization Frame uses the same
source. A separate composition can pass one shared `placement` object to Frame,
Mount and NavigationEntry; pass data across the server/client boundary, not href
functions. Existing root placement and compatibility exports remain available.

The nested members route moves with the selected route. Its thin page renders
`OrganizationMembersMount` from the same `index.server` entry, after awaiting
`params.id`. The mount independently verifies membership and full TeamAccess;
the ready overview derives the Members link from placement's `membersHref(id)`.
An explicitly composed `OrganizationAccessClient` can supply `membersHref` or
omit it when that downstream does not mount the reference members page.

## Explicit nonhierarchical destinations

`OrganizationAccessClient` from `@/_pages/organization-access` retains its explicit
props: `admission`, `input`, `explicitList`, `contextHref`, `pageHref`, `listHref`,
`loginHref`, `dashboardHref`, `onReplace` and `onReload`. A client composition may
supply independent destinations and callbacks. Obtain safe admission through the
public entity server DAL and keep the page-level server gate. Use
`useRouteProgressRouter()` and `RouteProgressLink` for internal navigation.
If customizing login links here, align your own server gate too; the ordinary
mount's server login destination remains `/login`.

## A headless block inside CRM

Keep the Next route thin and compose custom server/client UI in a `_pages` slice.
Its server composition reads `readOrganizationBootstrap(await headers())` from
`@/entities/organization-context/index.server`, validates the requested organization
ID, and passes only safe admission and target to a client component. Missing
session uses `redirectToLogin()`; infrastructure errors rethrow to the error
boundary. Reuse existing `SessionNotFoundError`/`ContextRequestError` classification.

The interactive block imports only public entity APIs and shared primitives:

```tsx
'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { ProductAccessBootstrap } from '@amcore/shared'

import { useOrganizationContext } from '@/entities/organization-context'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

export function CrmClient({ admission, id }: { admission: ProductAccessBootstrap; id: string }) {
  const locale = useLocale()
  const t = useTranslations('crmContext')
  const context = useOrganizationContext(admission.binding, { kind: 'selected', id, locale })
  const company =
    context.data && 'organization' in context.data.data ? context.data.data.organization : undefined
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <section
        className="space-y-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
        aria-busy={context.state.status === 'pending'}
      >
        <h2 className="font-semibold">{t('heading')}</h2>
        <p role="status">{t(context.state.status)}</p>
        {company && (
          <dl>
            <dt>{t('company')}</dt>
            <dd>{company.name}</dd>
            <dt>{t('account')}</dt>
            <dd>{admission.actor.email}</dd>
          </dl>
        )}
        {context.state.status === 'error' && <ApiErrorAlert error={context.state.error} />}
        <Button
          disabled={
            ['pending', 'missing', 'changed'].includes(context.state.status) ||
            Boolean(context.state.retryAt)
          }
          onClick={() => void context.refresh().catch(() => undefined)}
        >
          {t('refresh')}
        </Button>
        {context.state.status === 'missing' && (
          <RouteProgressLink href="/login" prefetch={false}>
            {t('login')}
          </RouteProgressLink>
        )}
        {context.state.status === 'changed' && (
          <Button onClick={() => window.location.reload()}>{t('reload')}</Button>
        )}
        <RouteProgressLink href="/" prefetch={false}>
          {t('home')}
        </RouteProgressLink>
      </section>
    </main>
  )
}
```

Add every `crmContext` key to each supported catalogue, including all lifecycle
statuses. Compose Refresh, missing-session sign-in and changed-session Reload in
your own presentation using shared Button/RouteProgressLink. Render structured
errors with ApiErrorAlert; disable recovery controls where the current status
requires it. Refresh remains available after a transport error or denied authority
once Retry-After expires; missing and changed sessions use Sign in and Reload
instead. The hook exposes data only for a ready, current consumer. One parent
owns context and passes its result to multiple blocks; do not duplicate request
lifecycle, call bootstrap manually in effects or refetch a disabled Query observer.

A CRM route may use `?organization=<id>` and its own navigation, with a compact
status card or definition list instead of the ready overview. It imports no ready
organization feature, widget, page, mount, AppShell or Console. The typed browser
namespace remains `/api/product-access`; page placement never changes it.

For a downstream CRM list, load rows and their server-evaluated record/field hints
in one response. Omit unreadable rows. An authorized row can enable Delete;
for a readable row where deletion is denied, keep the action disabled and give a
visible reason associated with it, plus a keyboard-reachable explanation:

```tsx
<div>
  <button type="button" disabled aria-describedby={`delete-reason-${row.id}`}>
    {t('delete')}
  </button>
  <span id={`delete-reason-${row.id}`} role="note" tabIndex={0}>
    {t('deleteDenied')}
  </span>
</div>
```

Use `deleteDenied` = “You can't delete this record.” / “Вы не можете удалить
эту запись.” in the CRM's EN/RU catalogues. Hide stale row controls while
authority refreshes; on a 403, explain and refresh authority without replaying
the delete. The server must check the operation again. This is an integration
example, not a delivered CRM screen. See the
[capability guide](../auth/capability-catalogue.md) for `recordRequired` and
field decisions.

## Validate your composition

Check menu links from dashboard and organization frame, direct list/id entry,
single-organization auto-open, explicit-list return and page two. Check a no-cookie
visit, mounted session loss, a nonmember/removed organization and a replaced login.
A changed login must hide old content and offer explicit recovery before new
identity authority is shown. Check locales, keyboard/focus, mobile navigation,
themes and error boundaries. Use the [managed stands](../operations/local-stands.md)
for real sessions and membership proof. Type/lint alone do not prove these flows.

## Custom member editor

Use the public `useOrganizationMembers(context.controller, {page, search})` and
`useMemberRoleAssignments(context.controller, {userId, page, search, section})`
hooks with that same parent owner. Keep a complete assigned-set snapshot and
its membership/ACL revision separate from paginated choices and your dirty draft.
Call `save({expectedMemberId, expectedAclVersion, roleIds})`; inspect `committed`,
`rejected`, `unknown`, `busy` and `retired` outcomes. A committed result includes
follow-up status. Never turn a failed follow-up into a claimed write rollback.

The executable `scripts/fixtures/organization-members-headless.mjs` creates a
separate disposable consumer with a list and inline editor instead of the ready
table/dialog. `--projected` also selects single-Russian routing, Console disabled
and Storybook disabled in that fixture. It prints the managed real-stack browser
command; no standalone sample product route is added to the starter. See the
[members contract](organization-members.md) for permissions, complete-set/byte
limits, truthful self-edit warnings and safe recovery.

## Custom invitation forms

Keep invitation state and presentation separate. The public browser transport in
`@/entities/invitation-flow` sends strict flow bindings, validates safe responses,
and exposes receipt recovery independently of an expired invitation flow.
`createInvitationAcceptJournal` stores only the operation ID and inspected
invitation ID/generation in tab storage. It stores no password, token, cookie,
continuation credential or permission to join. If storage is disabled, retain
the descriptor in memory and explain that reload recovery is limited.

The ready `RecipientAuth`, `RecipientStatus`, `RecipientFrame` and
`RecipientSkeleton` components from `@/_pages/invitation-recipient` are optional
presentation. `InvitationConsent` from `@/features/invitation-acceptance` renders
the complete inspected role set, expiry and explicit actions. A downstream may
replace these components with its own fields, cards or layout while retaining
the transport and continuation protocol.

Existing `LoginForm` and `RegisterForm` accept a cohesive
`CredentialFormAdapter` from `@/shared/lib/credential-form-adapter`. Application
composition supplies `submit`, `isCurrent` and `onSuccess`; invited registration
also supplies `fixedEmail`. Use `createInvitationCredentialAdapters` from
`@/_app/invitation-flow/index.client` to compose the ready forms. It authenticates
once, reports the safe pending handoff, sends a separate acknowledgment, and
resolves only after confirmation. The registration request derives its email
from the server-held invitation, regardless of client form contents.

Keep one continuation owner for the screen. Its callbacks show progress,
refresh safe state after failure, and retire stale results on account or flow
changes. Recreate forms/adapters when the authoritative flow revision changes;
do not resend an authentication request whose outcome is unknown. Recover the
same handoff acknowledgment instead. Authentication, verification and screen
mounting never accept organization membership. Joining requires a separate
explicit action with the inspected intent and a stable operation ID.
