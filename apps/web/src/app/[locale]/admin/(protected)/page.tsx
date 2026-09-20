import { OverviewPage } from '@/_pages/console'
import { requireSuperAdmin } from '@/shared/lib/require-super-admin'

export default async function AdminPage() {
  await requireSuperAdmin()
  return <OverviewPage />
}
