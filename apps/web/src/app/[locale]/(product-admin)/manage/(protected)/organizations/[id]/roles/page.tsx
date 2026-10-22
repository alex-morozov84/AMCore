import { OrganizationRolesMount } from '@/_app/organization-access/index.server'
import { ProductAdminRecovery, requireProductAdmin } from '@/_app/product-admin'

export const dynamic = 'force-dynamic'
export default async function Roles({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  await requireProductAdmin({ page: 'roles', orgId: id }, await searchParams)
  return (
    <OrganizationRolesMount
      deniedContent={<ProductAdminRecovery />}
      id={id}
      searchParams={searchParams}
    />
  )
}
