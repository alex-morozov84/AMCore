'use client'

import { useTranslations } from 'next-intl'
import { type LoginInput, loginSchema } from '@amcore/shared'

import { useLocalizedForm } from '@/shared/hooks'
import type { CredentialFormAdapter } from '@/shared/lib/credential-form-adapter'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import { PasswordInput } from '@/shared/ui/password-input'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import { useLogin } from '../model/use-login'

export interface LoginFormProps {
  adapter?: CredentialFormAdapter<LoginInput>
  initialEmail?: string
  disabled?: boolean
}

export function LoginForm({ adapter, initialEmail = '', disabled = false }: LoginFormProps = {}) {
  const passwordT = useTranslations('common')
  const t = useTranslations('auth')

  const form = useLocalizedForm<LoginInput>(loginSchema, {
    defaultValues: {
      email: initialEmail,
      password: '',
    },
  })

  // Pass setError to hook for automatic field-level error handling
  const { mutate, isPending, error } = useLogin(form.setError, adapter)

  const onSubmit = (data: LoginInput) => {
    if (!disabled && !isPending) mutate(data)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        <ApiErrorAlert error={error} />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('email')}</FormLabel>
              <FormControl>
                <Input type="email" placeholder="email@example.com" {...field} disabled={disabled} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>{t('password')}</FormLabel>
                {/* `underline`, not `hover:underline` — see LoginPage's
                identical link-in-text-block reasoning below. */}
                <RouteProgressLink
                  href="/forgot-password"
                  className="text-sm text-primary underline"
                >
                  {t('forgotPassword')}
                </RouteProgressLink>
              </div>
              <FormControl>
                <PasswordInput showLabel={passwordT('showPassword')} hideLabel={passwordT('hidePassword')} {...field} disabled={disabled} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={isPending || disabled}>
          {isPending ? t('loggingIn') : t('login')}
        </Button>
      </form>
    </Form>
  )
}
