'use client'

import { useTranslations } from 'next-intl'
import { type LoginInput, loginSchema } from '@amcore/shared'

import { useLocalizedForm } from '@/shared/hooks'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

import { useConsoleLogin } from '../model/use-console-login'

export function ConsoleLoginForm() {
  const t = useTranslations('console')
  const form = useLocalizedForm<LoginInput>(loginSchema, {
    defaultValues: { email: '', password: '' },
  })
  const { mutate, isPending, error } = useConsoleLogin(form.setError)

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => mutate(data))} noValidate className="space-y-4">
        <ApiErrorAlert error={error} />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('loginEmail')}</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" {...field} />
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
              <FormLabel>{t('loginPassword')}</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? t('signingIn') : t('signIn')}
        </Button>
      </form>
    </Form>
  )
}
