import type { ReactNode } from 'react'

import { Card, CardContent } from '@/shared/ui/card'

/** Server-compatible reference placement; downstreams can compose their own frame. */
export function RecipientFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-xl p-4 sm:p-6">
      <Card>
        <CardContent className="p-6">{children}</CardContent>
      </Card>
    </div>
  )
}
