'use client'

import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

import { getQueryClient } from './query-client'

interface QueryProviderProps {
  children: ReactNode
  /** CSP nonce for `ReactQueryDevtools`' inline styles (`styleNonce`) — see
   * `apps/web/src/shared/lib/csp/build-csp.ts`'s `style-src-elem` directive.
   * Only matters in development: the devtools component itself renders
   * nothing outside `NODE_ENV=development`. */
  nonce?: string
}

export function QueryProvider({ children, nonce }: QueryProviderProps) {
  const queryClient = getQueryClient()

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} styleNonce={nonce} />
    </QueryClientProvider>
  )
}
