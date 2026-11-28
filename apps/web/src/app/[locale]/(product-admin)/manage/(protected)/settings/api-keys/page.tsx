import { OwnApiKeysMount } from '@/_app/organization-access/index.server'
import { requireProductAdmin } from '@/_app/product-admin'

export default function OwnKeys({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <OwnApiKeysMount
      searchParams={searchParams}
      requireAccess={async () => {
        await requireProductAdmin({ page: 'own-keys' }, await searchParams)
      }}
    />
  )
}
