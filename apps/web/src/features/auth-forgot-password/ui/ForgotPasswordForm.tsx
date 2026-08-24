'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { type ForgotPasswordInput, forgotPasswordSchema } from '@amcore/shared'

import { useLocalizedForm } from '@/shared/hooks'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

import { useForgotPassword } from '../model/use-forgot-password'

/**
 * On success, swaps the form for a confirmation message rather than
 * navigating — the backend's own response `message` is deliberately never
 * rendered (English, developer-facing prose); this is the frontend's own
 * translated copy for the same enumeration-safe outcome.
 */
export function ForgotPasswordForm() {
  const t = useTranslations('auth')
  const [submitted, setSubmitted] = useState(false)

  const form = useLocalizedForm<ForgotPasswordInput>(forgotPasswordSchema, {
    defaultValues: { email: '' },
  })

  const { mutate, isPending, error } = useForgotPassword(form.setError)

  if (submitted) {
    return <p className="text-sm text-muted-foreground">{t('forgotPasswordSuccess')}</p>
  }

  const onSubmit = (data: ForgotPasswordInput) => {
    mutate(data, { onSuccess: () => setSubmitted(true) })
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
                <Input type="email" placeholder="email@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? t('sendingResetLink') : t('sendResetLink')}
        </Button>
      </form>
    </Form>
  )
}
