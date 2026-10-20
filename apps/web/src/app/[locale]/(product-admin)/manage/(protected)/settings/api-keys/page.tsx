import { OwnApiKeysMount } from '@/_app/organization-access/index.server'
import { requireProductAdmin } from '@/_app/product-admin'

export default async function OwnKeys({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireProductAdmin({ page: 'own-keys' }, await searchParams)
  return <OwnApiKeysMount searchParams={searchParams} />
}
