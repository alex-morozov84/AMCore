import { requireProductAdmin } from '@/_app/product-admin'
import { SessionsPage } from '@/_pages/settings'

export default async function Sessions() {
  await requireProductAdmin({ page: 'sessions' })
  return <SessionsPage />
}
