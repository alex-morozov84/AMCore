'use client'

import { useForm } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { type LoginInput, loginSchema } from '@amcore/shared'
import { zodResolver } from '@hookform/resolvers/zod'

import { getErrorMessage } from '@/shared/api'
import {
  Alert,
  AlertDescription,
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@/shared/ui'

import { useLogin } from '../model/use-login'

export function LoginForm() {
  const t = useTranslations('auth')

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
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

  const errorMessage = error ? getErrorMessage(error, 'Ошибка входа') : null

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        {errorMessage && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

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
          {isPending ? 'Вход...' : t('login')}
        </Button>
      </form>
    </Form>
  )
}
