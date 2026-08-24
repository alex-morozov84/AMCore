'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Link } from '@/i18n/navigation'
import { useLocalizedForm } from '@/shared/hooks'
import { cn } from '@/shared/lib/utils'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button, buttonVariants } from '@/shared/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

import {
  type NewPasswordInput,
  newPasswordSchema,
  useResetPassword,
} from '../model/use-reset-password'

interface ResetPasswordFormProps {
  /** The `?token=` query param `(auth)/reset-password/page.tsx` read from
   * the emailed link (`localizedFrontendUrl` on the backend). Absent when
   * the page is opened without one — a mistyped/stale link, not a
   * validation failure the form itself can recover from. */
  token?: string
}

/**
 * Three states, no client-side "confirm password" field invented —
 * `resetPasswordSchema` has none, matching `RegisterForm`'s single-password
 * precedent. Success stays in-page (a confirmation card + a link to
 * `/login`) rather than navigating there automatically: the backend
 * deletes every session on reset, so there is nothing to resume mid-flow.
 */
export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const t = useTranslations('auth')
  const tErrors = useTranslations('errors')
  const [submitted, setSubmitted] = useState(false)

  const form = useLocalizedForm<NewPasswordInput>(newPasswordSchema, {
    defaultValues: { password: '' },
  })

  const { mutate, isPending, error } = useResetPassword(form.setError)

  if (!token) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-destructive">{tErrors('TOKEN_INVALID')}</p>
        <Link href="/forgot-password" className={cn(buttonVariants(), 'w-full')}>
          {t('requestNewLink')}
        </Link>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted-foreground">{t('resetPasswordSuccess')}</p>
        <Link href="/login" className={cn(buttonVariants(), 'w-full')}>
          {t('login')}
        </Link>
      </div>
    )
  }

  const onSubmit = (data: NewPasswordInput) => {
    mutate({ ...data, token }, { onSuccess: () => setSubmitted(true) })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        <ApiErrorAlert error={error} />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('newPassword')}</FormLabel>
              <FormControl>
                <Input type="password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? t('resettingPassword') : t('resetPasswordSubmit')}
        </Button>
      </form>
    </Form>
  )
}
