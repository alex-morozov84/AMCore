# Top Route Progress Bar

The bar appears at the top of the viewport while a supported navigation is pending.

## Semantics

The bar represents **supported client-navigation intent through destination
pathname/query commit**, not byte progress or completion of every streamed
child. Content still loading after the URL commits belongs in that route's
`loading.tsx` or `<Suspense>` fallback.

It is decorative (`aria-hidden="true"`); Next's route announcer owns the
accessible route-change announcement.

## What starts it, and what doesn't

| Trigger                                                                                                                           | Starts the bar? |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| A `<RouteProgressLink>` click accepted as a same-origin client navigation                                                         | Yes             |
| `useRouteProgressRouter()`'s `push()`/`replace()`/`back()`/`forward()`                                                            | Yes             |
| Browser Back/Forward (`popstate`) to a different pathname/query                                                                   | Yes             |
| A caller cancelling a Link in `onClick` or `onNavigate`                                                                           | No              |
| Modifier/right click, a non-self `target`, `download`, or an external URL                                                         | No              |
| A `RouteProgressLink` to the current pathname/query, including a hash-only change | No |
| `router.refresh()` / `router.prefetch()`                                                                                          | No              |
| A native `<a>`, `window.location`, hard reload, or server-side redirect (the browser owns these full-document/server transitions) | No              |

With the flag enabled, programmatic `push()` and `replace()` start the
progress timer even for the current pathname/query. If no destination commits,
the bar can appear after the reveal delay and then clear on the safety timer.

A navigation that never commits self-clears: the bar reveals after 120ms and
begins completing roughly six seconds later by default.

## The two building blocks: use these, not raw Next APIs

**`RouteProgressLink`** (`@/shared/ui/route-progress-link`) is the canonical
way to render an internal navigating Link whether the source flag is on or off.
It wraps `@/i18n/navigation`'s locale-aware `Link` and starts the bar from
`next/link`'s `onNavigate` prop. Next calls it only for a same-origin client
navigation candidate; the wrapper runs the caller's handler first, so
`event.preventDefault()` cancels both navigation and progress. A component
passing an event handler must itself be a Client Component.

```tsx
import { useTranslations } from 'next-intl'

import { RouteProgressLink } from '@/shared/ui/route-progress-link'

export function DashboardLink() {
  const t = useTranslations('nav')
  return <RouteProgressLink href="/">{t('dashboard')}</RouteProgressLink>
}
```

**`useRouteProgressRouter()`** (`@/shared/lib/route-progress/use-route-progress-router`)
is the canonical way to trigger a _programmatic_ client navigation. It wraps
`@/i18n/navigation`'s `useRouter()` one-for-one — every option and type is
preserved — and only `push`/`replace`/`back`/`forward` gain a
`controller.start()` call before delegating. `refresh()`/`prefetch()` pass
straight through.

```tsx
'use client'

import type { ReactNode } from 'react'

import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

export function DashboardButton({ children }: { children: ReactNode }) {
  const router = useRouteProgressRouter()
  return <button onClick={() => router.push('/')}>{children}</button>
}
```

These router methods do not expose a cancellation callback. Validate or ask
for confirmation _before_ calling them; if a call produces no commit, the
safety timer clears the bar.

An Oxlint rule bans importing `Link` or `useRouter` directly from
`@/i18n/navigation` anywhere except these two adapters' own implementation
files, so a new call site cannot silently bypass the bar.

## Reduced motion, tokens, and CSP

The bar uses the semantic `--primary` token. Its multi-step animation lives in
`route-progress-bar.module.css`, the documented local-CSS escape hatch (see
[Boundaries & guardrails](./fsd-boundaries-and-guardrails.md)). It emits no
inline style or runtime `<style>` tag, so CSP needs no new allowance.

A viewer with `prefers-reduced-motion: reduce` gets no crawl animation and
no slide/fade transition: the bar jumps straight to its "in progress" width
and, on completion, only fades — instantly, not over time.

## The `ROUTE_PROGRESS_ENABLED` flag

`@/shared/lib/route-progress/route-progress-flag` exports one constant:

```ts
export const ROUTE_PROGRESS_ENABLED = true
```

This is **not a runtime or user-facing toggle** — there is no environment
variable, remote flag, cookie, or settings UI. A developer or agent edits the
file and rebuilds/restarts the application. When `false`, the root layout does
not mount the progress component, so there is no progress-bar DOM, global
listener, or progress timer. Keep using `RouteProgressLink` and
`useRouteProgressRouter()`; they delegate normally but do not call
`controller.start()`. Setting the constant back to `true` and rebuilding fully
restores the feature without regenerating files.

### Turn the bar off in a fork

Set `ROUTE_PROGRESS_ENABLED` to `false` in
`shared/lib/route-progress/route-progress-flag.ts` and rebuild. Nothing else changes:
the component, controller, adapter, tests, story and lint guard stay in place, and
setting the flag back to `true` restores the feature. The upstream default is enabled.

## Testing

Unit tests cover the controller, adapters, `popstate`, completion, cancellation,
same-page filtering, and disabled pass-through. The mocked Playwright suite
proves delayed Link/router/Back navigation, fast navigation, modifier-click,
and reduced-motion behavior in a real browser. Storybook
(`shared/ui/RouteProgressBar`) shows the visual phases only; its Next Link mock
does not implement `onNavigate`.

Run the focused checks after changing this feature:

```bash
pnpm --filter web test
pnpm --filter @amcore/shared build
pnpm --filter web test:e2e
```
