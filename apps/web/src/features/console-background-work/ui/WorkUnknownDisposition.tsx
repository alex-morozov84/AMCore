'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { type WorkReconciliation, workReconciliationSchema } from '@amcore/shared'
import { z } from 'zod'

import { consoleApi } from '@/shared/api/console-api'
import { useLocalizedForm } from '@/shared/hooks'
import { useStepUpMutation } from '@/shared/lib/console-step-up-mutation'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { ConsoleStepUpDialog } from '@/shared/ui/console-step-up-dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

type Subject =
  | { kind: 'command'; id: string; revision: number }
  | { kind: 'evidence'; id: string; workId: string; incarnation: string; revision: number }
const schema = z.strictObject({
  reason: workReconciliationSchema.shape.reason,
  references: z
    .string()
    .max(194)
    .superRefine((value, ctx) => {
      if (
        !workReconciliationSchema.shape.references.safeParse(
          value.trim() ? value.split(',').map((item) => item.trim()) : []
        ).success
      )
        ctx.addIssue({ code: 'custom' })
    }),
})

/** Shared metadata-only confirmation, with immutable subject and body across password confirmation. */
export function WorkUnknownDisposition({
  subject,
  refresh,
}: {
  subject: Subject
  refresh(): void
}) {
  const t = useTranslations('console.backgroundWork.control')
  const captured = useRef<{ subject: Subject; input: WorkReconciliation } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const form = useLocalizedForm<z.infer<typeof schema>>(schema, {
    defaultValues: { reason: '', references: '' },
  })
  const action = useStepUpMutation({
    mutationFn: async () => {
      if (!captured.current) throw new Error('MISSING_RECONCILIATION_CONFIRMATION')
      const { subject: target, input } = captured.current
      if (target.kind === 'command')
        await consoleApi.reconcileBackgroundWorkCommand(target.id, input)
      else await consoleApi.reconcileBackgroundWorkEvidence(target.workId, target.id, input)
    },
    onSuccess: () => {
      setError(null)
      refresh()
    },
    onError: (failure) => {
      setError(failure)
      refresh()
      return true
    },
  })
  return (
    <div className="space-y-3 border-t pt-3">
      <p className="text-sm text-warning">
        {t(subject.kind === 'command' ? 'recoveryMeaning' : 'evidenceRecoveryMeaning')}
      </p>
      <ApiErrorAlert error={error} />
      <Form {...form}>
        <form
          noValidate
          className="space-y-3"
          onSubmit={(event) =>
            void form.handleSubmit((values) => {
              if (action.isSubmitting || action.isSteppingUp || action.stepUp.kind !== 'closed')
                return
              captured.current = {
                subject: structuredClone(subject),
                input: workReconciliationSchema.parse({
                  revision: subject.revision,
                  disposition: 'acknowledged_unknown',
                  reason: values.reason,
                  ...(subject.kind === 'evidence' ? { incarnation: subject.incarnation } : {}),
                  references: values.references.trim()
                    ? values.references.split(',').map((item) => item.trim())
                    : [],
                }),
              }
              void action.confirm()
            })(event)
          }
        >
          <FormField
            control={form.control}
            name="reason"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('reason')}</FormLabel>
                <FormControl>
                  <Input {...field} maxLength={250} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="references"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('evidenceReferences')}</FormLabel>
                <FormControl>
                  <Input {...field} maxLength={194} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={action.isSubmitting || action.isSteppingUp || action.stepUp.kind !== 'closed'}
          >
            {t(subject.kind === 'command' ? 'acknowledgeUnknown' : 'acknowledgeEvidence')}
          </Button>
        </form>
      </Form>
      <ConsoleStepUpDialog
        phase={action.stepUp}
        isSubmitting={action.isSteppingUp}
        onSubmit={(password) => void action.submitStepUp(password)}
        onClose={action.closeStepUp}
      />
    </div>
  )
}
