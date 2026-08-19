import { DashboardPage } from '@/_pages/dashboard'
import { requireSession } from '@/shared/api/bff/dal'

// `requireSession()` always reads `cookies()` — without this, `next build`
// would still attempt a static-shell render first, discover the dynamic API
// use, and bail with an internal `DynamicServerError` on every build. Not a
// bug (the final route is correctly marked dynamic either way), just build
// noise and a wasted prerender attempt for a route that can never be static.
export const dynamic = 'force-dynamic'

/**
 * `requireSession()` is the real auth gate — not `(dashboard)/layout.tsx`.
 * See `dal.ts`'s doc: layouts don't re-render on client-side navigation
 * between sibling routes underneath them, so a check that only lived there
 * would stop being a real gate the moment a second protected page exists.
 */
export default async function Dashboard() {
  const { user } = await requireSession()

  return <DashboardPage userName={user.name} />
}
