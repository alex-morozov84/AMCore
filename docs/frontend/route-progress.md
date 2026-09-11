# Top Route Progress Bar

A first-party, YouTube-style progress bar fixed to the top of the viewport,
shown while a navigation is pending. No dependency was added for it — see
"Why first-party, not a dependency" below.

## Semantics

The bar represents **accepted navigation intent through destination
pathname/query commit**, not byte progress and not the completion of every
streamed child on the destination page. It starts the moment a real
navigation begins and finishes the moment the destination's pathname/query
actually change — what happens inside the new page after that (streamed
content, its own `loading.tsx`/`<Suspense>` boundaries) is a separate
concern. Route-specific loading skeletons stay exactly that: separate.

It is purely decorative: `aria-hidden="true"`. Next's own route announcer
owns the accessible route-change announcement; this bar adds nothing to
the accessibility tree.

## What starts it, and what doesn't

| Trigger                                                                                                                        | Starts the bar?                                             |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| A `<RouteProgressLink>` click that Next accepts as a real, uncancelled, same-origin client-side navigation                     | Yes                                                         |
| `useRouteProgressRouter()`'s `push()`/`replace()`/`back()`/`forward()`                                                         | Yes                                                         |
| Real browser Back/Forward (`popstate`) to a different location                                                                 | Yes                                                         |
| A link/modifier-click Next itself treats as "open elsewhere" (`Cmd`/`Ctrl`/`Shift`/`Alt`-click, `target="_blank"`, `download`) | No — Next's own `<Link>` never calls `onNavigate` for these |
| An external URL                                                                                                                | No — same reason                                            |
| A link to the exact page already showing, hash-only included (`#section`, `?tab=x` with the same value)                        | No                                                          |
| An application's own `onNavigate` (or `useRouteProgressRouter` caller) that cancels the navigation                             | No                                                          |
| `router.refresh()` / `router.prefetch()`                                                                                       | No — neither is a "navigation" this bar represents          |

A navigation that starts and never commits (aborted, failed, or the
destination simply never resolves) does not strand the bar forever: a
safety-net timer force-finishes it after `maxDurationMs` (default 6000ms).

## The two building blocks: use these, not raw Next APIs

**`RouteProgressLink`** (`@/shared/ui/route-progress-link`) is the only
sanctioned way to render a _navigating_ `<Link>` once the bar is enabled.
It wraps `@/i18n/navigation`'s locale-aware `Link` and starts the bar from
`next/link`'s `onNavigate` prop — which Next calls only after it has
already decided this is a genuine, uncancelled, same-origin client-side
navigation (modifier-key clicks, `target`, `download`, and external URLs
never reach it at all). If the caller also passes its own `onNavigate`,
that handler runs first and its `event.preventDefault()` is a real,
observed cancellation — the bar does not start.

```tsx
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

;<RouteProgressLink href="/settings">Settings</RouteProgressLink>
```

**`useRouteProgressRouter()`** (`@/shared/lib/route-progress/use-route-progress-router`)
is the only sanctioned way to trigger a _programmatic_ navigation. It wraps
`@/i18n/navigation`'s `useRouter()` one-for-one — every option and type is
preserved — and only `push`/`replace`/`back`/`forward` gain a
`controller.start()` call before delegating. `refresh()`/`prefetch()` pass
straight through.

```tsx
const router = useRouteProgressRouter()
router.push('/dashboard')
```

An ESLint rule bans importing `Link` or `useRouter` directly from
`@/i18n/navigation` anywhere except these two adapters' own implementation
files, so a new call site cannot silently bypass the bar.

## Why first-party, not a dependency

The obvious off-the-shelf choice, `nextjs-toploader`, was evaluated and
rejected: it injects runtime CSS (this starter's design-token/CSP
discipline wants build-time CSS only), has no reduced-motion handling,
patches `History` without restoring it, treats `popstate` only as a
completion signal, and still needs a separate programmatic-router
integration layered on top. Next's own `loading.tsx`/`<Suspense>` and
per-Link `useLinkStatus` are complementary, not a substitute — neither
gives a single global start signal across every navigation source. The
whole implementation here is under 300 lines across a handful of files;
depending on a package for it would trade a dependency for less control
over exactly the CSS/CSP/reduced-motion/History behaviors that ruled the
existing option out.

## Reduced motion, tokens, and CSP

The bar's color comes from the semantic `--primary` token — no raw color,
same rule as every other `shared/ui` component. It is the first `shared/ui`
component to use a CSS Module (`route-progress-bar.module.css`) rather than
Tailwind utilities: the crawl/fade is a multi-step `@keyframes` animation
plus a phase-driven `transition`, and a CSS Module is this repo's documented
escape hatch for exactly that (see
[Boundaries & guardrails](./fsd-boundaries-and-guardrails.md)). It emits no
inline `style` attribute and no runtime `<style>` tag — everything is a
build-time stylesheet, so it adds nothing for CSP to allow.

A viewer with `prefers-reduced-motion: reduce` gets no crawl animation and
no slide/fade transition: the bar jumps straight to its "in progress" width
and, on completion, only fades — instantly, not over time.

## The `ROUTE_PROGRESS_ENABLED` flag

`@/shared/lib/route-progress/route-progress-flag` exports one constant:

```ts
export const ROUTE_PROGRESS_ENABLED = true
```

This is **not a runtime or user-facing toggle** — there is no environment
variable, remote flag, cookie, or settings UI for it (owner decision,
2026-09-09). It is a documented, developer/agent-facing code flag: a human
or an agent edits this file directly to turn the feature on or off. When
`false`, the Server Component root layout does not mount the client bar at
all — no DOM node, no listener, no timer — and `RouteProgressLink`/
`useRouteProgressRouter()` become plain pass-throughs with no
`controller.start()` call and no timer created. Flipping the constant back
to `true` fully restores the feature; nothing else needs to change or be
regenerated.

### `pnpm init:project --route-progress=disabled`

This is the **only** thing the scaffold flag does: it sets
`ROUTE_PROGRESS_ENABLED`'s _initial_ value to `false` in a fresh fork and
records `frontend_route_progress: disabled` in `PROJECT_CONTEXT.md`. Unlike
`--mode=single` or `--storybook=disabled`, this choice is **non-destructive**
— it never deletes the component, controller, adapter, tests, story, or
lint guard. A developer can flip `ROUTE_PROGRESS_ENABLED` back to `true` by
hand at any later point, without re-running the initializer or reconstructing
any file; keep `PROJECT_CONTEXT.md`'s field truthful when doing so. Omitting
the flag keeps the upstream default (enabled). See
[Brand, theme, and design tokens § Project scaffolding](./brand-theme-and-tokens.md#project-scaffolding)
for how this composes with the other `init:project` dimensions.

## Testing

- `route-progress-controller.test.ts` — the timing state machine, with fake
  timers (reveal delay, coalescing, the `maxDurationMs` safety net,
  `completingMs`, `dispose()`).
- `route-progress-link.test.tsx` / `use-route-progress-router.test.ts` — the
  two adapters in isolation (cancellation, same-page/hash/query filtering,
  the disabled-flag pass-through), mocking `@/i18n/navigation`.
- `route-progress-bar.test.tsx` — rendering, `popstate`, and the completion
  effect.
- `apps/web/e2e/mocked/route-progress-bar.spec.ts` — real browser proof
  against `next dev` (which never auto-prefetches): a delayed `<Link>`
  navigation, a delayed programmatic navigation via the locale switcher,
  browser Back not stranding the bar, a fast/already-resolved navigation
  never showing it, a modifier-click exclusion, and reduced motion.
- Storybook (`shared/ui/RouteProgressBar`) demonstrates the `Idle`/
  `Visible`/`Completing` phases in isolation for visual review; it does not
  cover Link-click starting, since `@storybook/nextjs-vite`'s `next/link`
  mock does not implement `onNavigate` at all.
