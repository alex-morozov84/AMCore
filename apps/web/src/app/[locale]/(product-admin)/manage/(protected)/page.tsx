import { requireProductAdmin } from '@/_app/product-admin'
import { DashboardPage } from '@/_pages/dashboard'

export default async function Dashboard() {
  const { user } = await requireProductAdmin({ page: 'organizations' })
  return <DashboardPage userName={user.name} />
}
