import { requireSession } from '@/shared/api/bff/dal'
import { SessionsPage } from '@/views/settings'

// `requireSession()` reads `cookies()` — see the identical export on
// `(dashboard)/page.tsx` for why this avoids build-time noise.
export const dynamic = 'force-dynamic'

export default async function Sessions() {
  await requireSession()

  return <SessionsPage />
}
