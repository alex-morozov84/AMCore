'use client'

import { useTranslations } from 'next-intl'
import { type RegisterInput, registerSchema } from '@amcore/shared'

import { useLocalizedForm } from '@/shared/hooks'
import type { CredentialFormAdapter } from '@/shared/lib/credential-form-adapter'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import { PasswordInput } from '@/shared/ui/password-input'

import { useRegister } from '../model/use-register'

export type RegisterFormProps = (
  | {
      adapter: CredentialFormAdapter<RegisterInput>
      fixedEmail: string
    }
  | { adapter?: never; fixedEmail?: never }
) & { disabled?: boolean }

export function RegisterForm({ adapter, fixedEmail, disabled = false }: RegisterFormProps = {}) {
  const passwordT = useTranslations('common')
  const t = useTranslations('auth')

  const form = useLocalizedForm<RegisterInput>(registerSchema, {
    defaultValues: {
      email: fixedEmail ?? '',
      password: '',
      name: '',
    },
  })

  // Pass setError to hook for automatic field-level error handling
  const { mutate, isPending, error } = useRegister(form.setError, adapter)

  const onSubmit = (data: RegisterInput) => {
    if (!disabled && !isPending) mutate(data)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        <ApiErrorAlert error={error} />

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('name')}</FormLabel>
              <FormControl>
                <Input placeholder={t('namePlaceholder')} {...field} disabled={disabled} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('email')}</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="email@example.com"
                  {...field}
                  readOnly={fixedEmail !== undefined}
                  disabled={disabled}
                />
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
              <FormLabel>{t('password')}</FormLabel>
              <FormControl>
                <PasswordInput
                  showLabel={passwordT('showPassword')}
                  hideLabel={passwordT('hidePassword')}
                  {...field}
                  disabled={disabled}
                />
              </FormControl>
              <FormDescription>{t('passwordRequirements')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={isPending || disabled}>
          {isPending ? t('registering') : t('register')}
        </Button>
      </form>
    </Form>
  )
}
