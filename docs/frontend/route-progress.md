# Top Route Progress Bar

A first-party, YouTube-style progress bar fixed to the top of the viewport,
shown while a navigation is pending. No dependency was added for it — see
"Why first-party, not a dependency" below.

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
| The current pathname/query, including `#section` or the same query via `?tab=x`                                                   | No              |
| `router.refresh()` / `router.prefetch()`                                                                                          | No              |
| A native `<a>`, `window.location`, hard reload, or server-side redirect (the browser owns these full-document/server transitions) | No              |

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
  return <button onClick={() => router.push('/dashboard')}>{children}</button>
}
```

These router methods do not expose a cancellation callback. Validate or ask
for confirmation _before_ calling them; if a call produces no commit, the
safety timer clears the bar.

An ESLint rule bans importing `Link` or `useRouter` directly from
`@/i18n/navigation` anywhere except these two adapters' own implementation
files, so a new call site cannot silently bypass the bar.

## Why first-party, not a dependency

`nextjs-toploader` was evaluated and rejected: it injects runtime CSS, has no
reduced-motion handling, leaves a patched `History` behind on unmount, treats
`popstate` only as completion, and still needs a separate router integration.
Next's `loading.tsx`/`<Suspense>` and `useLinkStatus` remain complementary
route/per-Link tools, not replacements for this global indicator.

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

### `pnpm init:project --route-progress=disabled`

This is the **only** thing the scaffold flag does: it sets
`ROUTE_PROGRESS_ENABLED`'s _initial_ value to `false` in a fresh fork and
records `frontend_route_progress: disabled` in `PROJECT_CONTEXT.md`. Unlike
`--mode=single` or `--storybook=disabled`, this choice is **non-destructive**
— it never deletes the component, controller, adapter, tests, story, or
lint guard. A developer can flip `ROUTE_PROGRESS_ENABLED` back to `true` by
hand at any later point, without re-running the initializer or reconstructing
any file. When changing it by hand, also set `PROJECT_CONTEXT.md`'s
`frontend_route_progress` field to `enabled` or `disabled` accordingly.
Omitting the scaffold flag keeps the upstream default (enabled). See
[Brand, theme, and design tokens § Project scaffolding](./brand-theme-and-tokens.md#project-scaffolding)
for how this composes with the other `init:project` dimensions.

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
pnpm test:scripts # required after source/docs that scaffolding transforms touch
```
