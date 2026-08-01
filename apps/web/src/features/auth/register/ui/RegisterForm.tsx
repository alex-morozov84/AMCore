'use client'

import { useTranslations } from 'next-intl'
import { type RegisterInput, registerSchema } from '@amcore/shared'

import { useLocalizedForm } from '@/shared/hooks'
import {
  ApiErrorAlert,
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@/shared/ui'

import { useRegister } from '../model/use-register'

export function RegisterForm() {
  const t = useTranslations('auth')

  const form = useLocalizedForm<RegisterInput>(registerSchema, {
    defaultValues: {
      email: '',
      password: '',
      name: '',
    },
  })

  // Pass setError to hook for automatic field-level error handling
  const { mutate, isPending, error } = useRegister(form.setError)

  const onSubmit = (data: RegisterInput) => {
    mutate(data)
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
                <Input placeholder={t('namePlaceholder')} {...field} />
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
              <FormLabel>{t('password')}</FormLabel>
              <FormControl>
                <Input type="password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? t('registering') : t('register')}
        </Button>
      </form>
    </Form>
  )
}
