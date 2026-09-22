'use client'

import { useTranslations } from 'next-intl'
import { type StepUpInput, stepUpSchema } from '@amcore/shared'

import { useLocalizedForm } from '@/shared/hooks'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

import type { StepUpPhase } from './use-user-role-change'

interface RoleStepUpDialogProps {
  phase: StepUpPhase
  isSubmitting: boolean
  onSubmit: (password: string) => void
  onClose: () => void
}

/**
 * ADR-037 step-up re-entry, opened by `UserRoleAction` on `STEP_UP_REQUIRED`.
 * The frontend cannot know in advance whether an account has a password
 * (OAuth-only accounts do not), so this dialog always renders the form; a
 * `STEP_UP_METHOD_UNAVAILABLE`/repeat-`STEP_UP_REQUIRED` response is
 * "terminal" — resubmitting the same password cannot fix it, so the form is
 * replaced with the error and a close action instead of inviting another
 * attempt.
 */
export function RoleStepUpDialog({
  phase,
  isSubmitting,
  onSubmit,
  onClose,
}: RoleStepUpDialogProps) {
  const t = useTranslations('console')
  const tCommon = useTranslations('common')
  const form = useLocalizedForm<StepUpInput>(stepUpSchema, { defaultValues: { password: '' } })
  const open = phase.kind !== 'closed'
  const terminal = phase.kind === 'error' && phase.terminal

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          form.reset()
          onClose()
        }
      }}
    >
      <DialogContent closeLabel={tCommon('close')}>
        <DialogHeader>
          <DialogTitle>{t('usersStepUpTitle')}</DialogTitle>
          <DialogDescription>{t('usersStepUpDescription')}</DialogDescription>
        </DialogHeader>
        {phase.kind === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            {phase.message}
          </p>
        )}
        {terminal ? (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tCommon('cancel')}
            </Button>
          </DialogFooter>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((data) => {
                form.reset()
                onSubmit(data.password)
              })}
              noValidate
              className="space-y-4"
            >
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
              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                  {tCommon('cancel')}
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {t('usersStepUpSubmit')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}
