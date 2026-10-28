'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { type MfaProof, mfaProofSchema } from '@amcore/shared'

import { useLocalizedForm } from '@/shared/hooks'

import { Button } from './button'
import { DialogFooter } from './dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './form'
import { Input } from './input'

/** Reuses the accepted app/backup proof choices inside the existing sensitive-action dialog. */
export function ConsoleStepUpProof({
  pending,
  unknown,
  onSubmit,
  onClose,
}: {
  pending: boolean
  unknown?: boolean
  onSubmit: (proof: MfaProof | null) => void
  onClose: () => void
}) {
  const t = useTranslations('accountMfa')
  const common = useTranslations('common')
  const [method, setMethod] = useState<MfaProof['method']>('totp')
  const form = useLocalizedForm<MfaProof>(mfaProofSchema, { defaultValues: { method, code: '' } })
  if (unknown)
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('unknownCodeWarning')}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {common('cancel')}
          </Button>
          <Button onClick={() => onSubmit(null)} disabled={pending}>
            {t('checkResult')}
          </Button>
        </DialogFooter>
      </div>
    )
  return (
    <Form {...form}>
      <form
        className="space-y-4"
        noValidate
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
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            const next = method === 'totp' ? 'recovery_code' : 'totp'
            setMethod(next)
            form.reset({ method: next, code: '' })
          }}
        >
          {t(method === 'totp' ? 'noApp' : 'appCode')}
        </Button>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {common('cancel')}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t('checking') : t('continue')}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}
