'use client'

import { useTranslations } from 'next-intl'
import { mfaEmergencyProofSchema } from '@amcore/shared'
import type { z } from 'zod'

import { useLocalizedForm } from '@/shared/hooks'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import { PasswordInput } from '@/shared/ui/password-input'

import { MfaActionButton, MfaActions } from './actions'

type EmergencyProof = z.infer<typeof mfaEmergencyProofSchema>

/** A deployment-issued ticket is a separate credential, never a backup-code parser. */
export function MfaEmergencyRecovery({
  pending,
  onSubmit,
}: {
  pending: boolean
  onSubmit: (proof: EmergencyProof) => void
}) {
  const t = useTranslations('accountMfa')
  const common = useTranslations('common')
  const form = useLocalizedForm<EmergencyProof>(mfaEmergencyProofSchema, {
    defaultValues: { password: '', ticket: '' },
  })
  return (
    <div className="space-y-4">
      <p>{t('emergencyDescription')}</p>
      <p className="text-sm text-muted-foreground">{t('emergencyFailureHelp')}</p>
      <Form {...form}>
        <form
          noValidate
          className="space-y-4"
          onSubmit={form.handleSubmit((proof) => {
            form.reset()
            onSubmit(proof)
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
          <FormField
            control={form.control}
            name="ticket"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('emergencyTicket')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    autoCapitalize="off"
                    disabled={pending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <MfaActions>
            <MfaActionButton type="submit" disabled={pending}>
              {t(pending ? 'checking' : 'continue')}
            </MfaActionButton>
          </MfaActions>
        </form>
      </Form>
    </div>
  )
}
