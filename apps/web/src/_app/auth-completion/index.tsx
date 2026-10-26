import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { AuthErrorCode, type SupportedLocale } from '@amcore/shared'

import { OAuthCompletionPage } from '@/_pages/auth'
import { ClientMessages } from '@/i18n/client-message-boundary'
import { redirect } from '@/i18n/navigation'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { oauthCompletionQuerySchema } from '@/shared/api/bff/oauth-completion-input'
import { resolveProductWebContext } from '@/shared/api/bff/product-web-context.server'

import 'server-only'

/** Public document selection precedes input handling; GET never accesses identity. */
export async function OAuthCompletionMount({
  query,
  locale,
  kind,
}: {
  query: Record<string, string | string[] | undefined>
  locale: SupportedLocale
  kind: 'site-auth' | 'admin-auth'
}) {
  let context
  try {
    context = resolveProductWebContext(await headers(), kind)
  } catch (error) {
    if (error instanceof ContextRequestError && error.status === 404) notFound()
    throw error
  }
  const parsed = oauthCompletionQuerySchema.safeParse(query)
  if (!parsed.success)
    return redirect({
      href: `${context.loginPath}?oauthError=${AuthErrorCode.OAUTH_TICKET_INVALID}`,
      locale,
    })
  return (
    <ClientMessages namespaces={['auth']}>
      <OAuthCompletionPage
        {...parsed.data}
        locale={locale}
        action={
          kind === 'admin-auth'
            ? '/api/product-admin/auth/oauth/complete'
            : '/api/auth/oauth/complete'
        }
      />
    </ClientMessages>
  )
}
