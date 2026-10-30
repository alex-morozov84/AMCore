import { randomUUID } from 'node:crypto'

import { getLocale, getTranslations } from 'next-intl/server'
import type { SupportedLocale } from '@amcore/shared'
import { z } from 'zod'

import { LoginPage } from '@/_pages/auth'
import { ClientMessages } from '@/i18n/client-message-boundary'

import { SignInAgainClient, type SignInAgainPlacement } from '../ui/sign-in-again-client'

import 'server-only'

/** Deliberate entry: no redirectIfAuthenticated, logout, cookie mutation or credential replay on GET. */
export async function SignInAgainMount({
  query,
  placement,
  standalone = false,
}: {
  query: { entryId?: string | string[]; returnEntryId?: string | string[] }
  placement: SignInAgainPlacement
  standalone?: boolean
}) {
  const t = await getTranslations('auth')
  const locale = (await getLocale()) as SupportedLocale
  const entryId = z.string().uuid().safeParse(query.entryId)
  const returnEntryId = z.string().uuid().safeParse(query.returnEntryId)
  const id = entryId.success ? entryId.data : randomUUID()
  const content = (
    <LoginPage
      oauthProviders={[]}
      publicSignupEnabled={false}
      title={t('signInAgainTitle')}
      loginForm={
        <SignInAgainClient
          key={`${placement.apiBase}:${id}`}
          placement={placement}
          entryId={id}
          locale={locale}
          returnEntryId={returnEntryId.success ? returnEntryId.data : undefined}
        />
      }
    />
  )
  return standalone ? (
    <ClientMessages namespaces={['auth']}>
      <main className="flex min-h-screen items-center justify-center p-4">{content}</main>
    </ClientMessages>
  ) : (
    content
  )
}
