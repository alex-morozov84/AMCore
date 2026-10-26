'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { type MfaMethod, type MfaProof, mfaProofSchema, stepUpSchema } from '@amcore/shared'

import { useLocalizedForm } from '@/shared/hooks'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import { PasswordInput } from '@/shared/ui/password-input'

import { MfaActionButton as Button, MfaActions } from './actions'

export function MfaProofForm({
  method,
  pending,
  onSubmit,
  submitLabel,
  destructive = false,
  secondaryActions,
}: {
  method: MfaMethod
  pending: boolean
  onSubmit: (proof: MfaProof) => void
  submitLabel: string
  destructive?: boolean
  secondaryActions?: ReactNode
}) {
  const t = useTranslations('accountMfa')
  const form = useLocalizedForm<MfaProof>(mfaProofSchema, { defaultValues: { method, code: '' } })
  return (
    <Form {...form}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((proof) => {
          form.reset({ method, code: '' })
          onSubmit(proof)
        })}
      >
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t(method === 'totp' ? 'appCode' : 'backupCode')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="text"
                  inputMode={method === 'totp' ? 'numeric' : 'text'}
                  autoComplete={method === 'totp' ? 'one-time-code' : 'off'}
                  spellCheck={false}
                  autoCapitalize="off"
                  disabled={pending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <MfaActions secondary={secondaryActions}>
          <Button
            type="submit"
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending}
          >
            {pending ? t('checking') : submitLabel}
          </Button>
        </MfaActions>
      </form>
    </Form>
  )
}

export function MfaPasswordForm({
  pending,
  onSubmit,
}: {
  pending: boolean
  onSubmit: (password: string) => void
}) {
  const t = useTranslations('accountMfa')
  const common = useTranslations('common')
  const form = useLocalizedForm<{ password: string }>(stepUpSchema, {
    defaultValues: { password: '' },
  })
  return (
    <Form {...form}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit(({ password }) => {
          form.reset()
          onSubmit(password)
        })}
      >
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('password')}</FormLabel>
              <FormControl>
                <PasswordInput
                  {...field}
                  autoComplete="current-password"
                  disabled={pending}
                  showLabel={common('showPassword')}
                  hideLabel={common('hidePassword')}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <MfaActions>
          <Button type="submit" disabled={pending}>
            {pending ? t('checking') : t('continue')}
          </Button>
        </MfaActions>
      </form>
    </Form>
  )
}
