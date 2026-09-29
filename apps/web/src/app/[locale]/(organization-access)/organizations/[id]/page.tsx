import { OrganizationAccessMount } from '@/_app/organization-access'

export const dynamic = 'force-dynamic'
export default async function SelectedOrganization({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <OrganizationAccessMount id={(await params).id} searchParams={searchParams} />
}
