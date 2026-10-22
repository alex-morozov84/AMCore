import { OrganizationRoleMount } from '@/_app/organization-access/index.server'
import { ProductAdminRecovery, requireProductAdmin } from '@/_app/product-admin'

export const dynamic = 'force-dynamic'
export default async function Role({
  params,
}: {
  params: Promise<{ id: string; roleId: string }>
}) {
  const { id, roleId } = await params
  await requireProductAdmin({ page: 'role', orgId: id, roleId })
  return <OrganizationRoleMount deniedContent={<ProductAdminRecovery />} id={id} roleId={roleId} />
}
