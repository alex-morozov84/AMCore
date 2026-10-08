import { OrganizationRolesMount } from '@/_app/organization-access/index.server'

export const dynamic = 'force-dynamic'
export default async function Roles({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <OrganizationRolesMount id={(await params).id} searchParams={searchParams} />
}
