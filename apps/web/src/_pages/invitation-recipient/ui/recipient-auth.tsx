'use client'

import { type ReactNode, useState } from 'react'
import { useTranslations } from 'next-intl'

import { LoginForm, type LoginFormProps } from '@/features/auth-login'
import { OAuthProviderActions, type OAuthProviderActionsProps } from '@/features/auth-oauth'
import { RegisterForm, type RegisterFormProps } from '@/features/auth-register'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'

export interface RecipientAuthProps {
  email: string
  oauthContent?: ReactNode
  busy: boolean
  error?: unknown
  login: NonNullable<LoginFormProps['adapter']>
  register: Extract<RegisterFormProps, { fixedEmail: string }>['adapter']
  oauth: Omit<OAuthProviderActionsProps, 'busy'>
  onLeave(): void
}

/** Ready composition; the continuation owns transport, while downstreams may replace this layout. */
export function RecipientAuth({
  email,
  busy,
  error,
  login,
  register,
  oauth,
  oauthContent,
  onLeave,
}: RecipientAuthProps) {
  const t = useTranslations('invitationRecipient')
  const auth = useTranslations('auth')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  return (
    <section className="space-y-6" aria-busy={busy}>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{t('signInTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('signInHelp', { email })}</p>
        <p className="text-sm text-muted-foreground">{t('explicitConsentHelp')}</p>
      </div>
      {oauthContent ?? <OAuthProviderActions {...oauth} busy={busy} />}
      <ApiErrorAlert error={error} />
      <Tabs
        value={mode}
        onValueChange={(value) => {
          if (!busy && (value === 'login' || value === 'register')) setMode(value)
        }}
      >
        <TabsList className="w-full">
          <TabsTrigger value="login" disabled={busy}>
            {auth('login')}
          </TabsTrigger>
          <TabsTrigger value="register" disabled={busy}>
            {auth('register')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="login" className="pt-4">
          <LoginForm initialEmail={email} adapter={login} disabled={busy} />
        </TabsContent>
        <TabsContent value="register" className="pt-4">
          <RegisterForm fixedEmail={email} adapter={register} disabled={busy} />
        </TabsContent>
      </Tabs>
      <Button variant="outline" onClick={onLeave}>
        {t('leave')}
      </Button>
      <p className="text-sm text-muted-foreground">{t('leaveHelp')}</p>
    </section>
  )
}
