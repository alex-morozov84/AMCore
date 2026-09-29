'use client'

import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'

export default function OrganizationAccessError({ reset }: { reset: () => void }) {
  return <PrimaryUnavailableFallback reason="upstream" onRetry={reset} />
}
