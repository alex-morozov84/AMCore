import { OrganizationInvitationsMount } from '@/_app/organization-access/index.server'

export const dynamic = 'force-dynamic'
export default async function Invitations({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <OrganizationInvitationsMount id={(await params).id} searchParams={searchParams} />
}
