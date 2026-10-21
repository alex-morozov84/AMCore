import { OrganizationAccessMount } from '@/_app/organization-access/index.server'
import { ProductAdminRecovery, requireProductAdmin } from '@/_app/product-admin'

export const dynamic = 'force-dynamic'
export default async function Organizations({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireProductAdmin({ page: 'organizations' }, await searchParams)
  return (
    <OrganizationAccessMount deniedContent={<ProductAdminRecovery />} searchParams={searchParams} />
  )
}
