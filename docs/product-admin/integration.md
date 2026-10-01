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
          disabled={context.state.status !== 'ready' || Boolean(context.state.retryAt)}
          onClick={context.refresh}
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
requires it. The hook exposes data only for a ready, current consumer. One parent
owns context and passes its result to multiple blocks; do not duplicate request
lifecycle, call bootstrap manually in effects or refetch a disabled Query observer.

A CRM route may use `?organization=<id>` and its own navigation, with a compact
status card or definition list instead of the ready overview. It imports no ready
organization feature, widget, page, mount, AppShell or Console. The typed browser
namespace remains `/api/product-access`; page placement never changes it.

## Validate your composition

Check menu links from dashboard and organization frame, direct list/id entry,
single-organization auto-open, explicit-list return and page two. Check a no-cookie
visit, mounted session loss, a nonmember/removed organization and a replaced login.
A changed login must hide old content and offer explicit recovery before new
identity authority is shown. Check locales, keyboard/focus, mobile navigation,
themes and error boundaries. Use the [managed stands](../operations/local-stands.md)
for real sessions and membership proof. Type/lint alone do not prove these flows.
