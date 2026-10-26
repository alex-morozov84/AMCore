'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { type RegisterInput, registerSchema } from '@amcore/shared'

import { useLocalizedForm } from '@/shared/hooks'
import type { CredentialFormAdapter } from '@/shared/lib/credential-form-adapter'
import { cn } from '@/shared/lib/utils'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button, buttonVariants } from '@/shared/ui/button'
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
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import { classifyRegisterError } from '../model/register-outcome'
import { useRegister } from '../model/use-register'

import { RegistrationCreatedNotice } from './RegistrationCreatedNotice'

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
  const outcome = classifyRegisterError(error)
  // With an adapter the composition owns recovery and the notice; this form is about to unmount.
  const created = outcome === 'created' && !adapter
  // A second submit would only answer 409, so a created account locks the form.
  const locked = disabled || created
  const { setValue } = form
  useEffect(() => {
    if (created) setValue('password', '')
  }, [created, setValue])

  const onSubmit = (data: RegisterInput) => {
    if (!locked && !isPending) mutate(data)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        {outcome === 'created' ? (
          created && <RegistrationCreatedNotice />
        ) : (
          <ApiErrorAlert error={error} />
        )}
        {outcome === 'unknown' && (
          <p className="text-sm text-muted-foreground">{t('registrationUnknownHelp')}</p>
        )}

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('name')}</FormLabel>
              <FormControl>
                <Input placeholder={t('namePlaceholder')} {...field} disabled={locked} />
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
                  disabled={locked}
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
                  disabled={locked}
                />
              </FormControl>
              <FormDescription>{t('passwordRequirements')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {created ? (
          <RouteProgressLink href="/login" className={cn(buttonVariants(), 'w-full')}>
            {t('registrationCreatedLink')}
          </RouteProgressLink>
        ) : (
          <Button type="submit" className="w-full" disabled={isPending || disabled}>
            {isPending ? t('registering') : t('register')}
          </Button>
        )}
      </form>
    </Form>
  )
}
