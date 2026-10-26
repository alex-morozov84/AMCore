import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { ProductAdminMessages } from '@/_app/product-admin'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { resolveProductWebContext } from '@/shared/api/bff/product-web-context.server'

export const dynamic = 'force-dynamic'

export default async function ProductAdminLayout({ children }: { children: ReactNode }) {
  try {
    resolveProductWebContext(await headers(), 'admin-auth')
  } catch (error) {
    if (error instanceof ContextRequestError && error.status === 404) notFound()
    throw error
  }
  return <ProductAdminMessages>{children}</ProductAdminMessages>
}
