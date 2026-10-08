import { OrganizationRoleMount } from '@/_app/organization-access/index.server'

export const dynamic = 'force-dynamic'
export default async function Role({
  params,
}: {
  params: Promise<{ id: string; roleId: string }>
}) {
  const { id, roleId } = await params
  return <OrganizationRoleMount id={id} roleId={roleId} />
}
