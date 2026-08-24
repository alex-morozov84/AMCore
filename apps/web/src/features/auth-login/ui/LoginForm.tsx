'use client'

import { useTranslations } from 'next-intl'
import { type LoginInput, loginSchema } from '@amcore/shared'

import { Link } from '@/i18n/navigation'
import { useLocalizedForm } from '@/shared/hooks'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

import { useLogin } from '../model/use-login'

export function LoginForm() {
  const t = useTranslations('auth')

  const form = useLocalizedForm<LoginInput>(loginSchema, {
    defaultValues: {
      email: '',
      password: '',
    },
  })

  // Pass setError to hook for automatic field-level error handling
  const { mutate, isPending, error } = useLogin(form.setError)

  const onSubmit = (data: LoginInput) => {
    mutate(data)
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

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>{t('password')}</FormLabel>
                {/* `underline`, not `hover:underline` — see LoginPage's
                identical link-in-text-block reasoning below. */}
                <Link href="/forgot-password" className="text-sm text-primary underline">
                  {t('forgotPassword')}
                </Link>
              </div>
              <FormControl>
                <Input type="password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? t('loggingIn') : t('login')}
        </Button>
      </form>
    </Form>
  )
}
