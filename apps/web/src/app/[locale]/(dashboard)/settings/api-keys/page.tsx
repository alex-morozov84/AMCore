import { OwnApiKeysMount } from '@/_app/organization-access/index.server'

export const dynamic = 'force-dynamic'
export default function OwnApiKeys({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <OwnApiKeysMount searchParams={searchParams} />
}
