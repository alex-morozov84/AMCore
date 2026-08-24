'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { type ResendVerificationInput, resendVerificationSchema } from '@amcore/shared'

import { useLocalizedForm } from '@/shared/hooks'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

import { useResendVerification } from '../model/use-resend-verification'

/**
 * Same enumeration-safe confirmation-swap pattern as `ForgotPasswordForm` —
 * the backend never reveals whether the account exists or is already
 * verified, and the frontend's own translated copy carries that outcome,
 * never the backend's response `message`.
 */
export function ResendVerificationForm() {
  const t = useTranslations('auth')
  const [submitted, setSubmitted] = useState(false)

  const form = useLocalizedForm<ResendVerificationInput>(resendVerificationSchema, {
    defaultValues: { email: '' },
  })

  const { mutate, isPending, error } = useResendVerification(form.setError)

  if (submitted) {
    return <p className="text-sm text-muted-foreground">{t('resendVerificationSuccess')}</p>
  }

  const onSubmit = (data: ResendVerificationInput) => {
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
          {isPending ? t('resendingVerification') : t('resendVerification')}
        </Button>
      </form>
    </Form>
  )
}
