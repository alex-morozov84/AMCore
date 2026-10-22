import { OAuthCompletionMount } from '@/_app/auth-completion'
import { resolveLocaleParam } from '@/i18n/params'

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <OAuthCompletionMount
      query={await searchParams}
      locale={await resolveLocaleParam(params)}
      kind="site-auth"
    />
  )
}
