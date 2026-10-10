'use client'

import { type ComponentProps, type ReactNode, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  workCommandSchema,
  type WorkJob,
  type WorkOperation,
  type WorkSummary,
} from '@amcore/shared'
import { z } from 'zod'

import { useLocalizedForm } from '@/shared/hooks'
import { useConsoleTimeZone } from '@/shared/lib/console-time-zone'
import { formatInputInstant, parseInputInstant } from '@/shared/lib/console-time-zone/input'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { CopyConsoleId } from '@/shared/ui/console-detail/CopyConsoleId'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Disclosure } from '@/shared/ui/disclosure'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { InfoTooltip } from '@/shared/ui/info-tooltip'
import { Input } from '@/shared/ui/input'

import { workLabel } from './work-label'
import { WorkProjection } from './WorkProjection'

const reasonSchema = z.strictObject({
  reason: workCommandSchema.shape.reason,
  cutoff: z.iso.datetime().optional(),
})

export function WorkCommandConfirmation({
  work,
  operation,
  targets = [],
  finalFocus,
  onClose,
  onConfirm,
  pending = false,
  error,
  result,
  open = true,
}: {
  pending?: boolean
  error?: unknown
  result?: ReactNode
  open?: boolean
  work: WorkSummary
  operation: WorkOperation
  targets?: WorkJob[]
  onClose(): void
  onConfirm(reason: string, cutoff?: string): void
  finalFocus: ComponentProps<typeof DialogContent>['finalFocus']
}) {
  const locale = useLocale()
  const currentZone = useConsoleTimeZone()
  const [inputZone] = useState(() => ({ mode: currentZone.mode, zone: currentZone.zone }))
  const t = useTranslations('console.backgroundWork.control')
  const common = useTranslations('common')
  const form = useLocalizedForm<z.infer<typeof reasonSchema>>(reasonSchema, {
    defaultValues: {
      reason: '',
      ...(operation === 'cleanup'
        ? {
            cutoff: new Date(
              Math.floor((Date.parse(work.sampledAt) - 86400000) / 1000) * 1000
            ).toISOString(),
          }
        : {}),
    },
  })
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        closeLabel={common('close')}
        finalFocus={finalFocus}
      >
        <DialogHeader>
          <DialogTitle>
            {t('confirmTitle', {
              operation: t(`actions.${operation}`),
              work: workLabel(work.presentation?.name, locale, work.id),
            })}
          </DialogTitle>
          <DialogDescription>{t(`${operation}Effect`)}</DialogDescription>
          <div>
            <InfoTooltip label={t('freshnessHelp')} />
          </div>
          {operation === 'retry' && (
            <div>
              <InfoTooltip label={t('manualRetryHelp')} />
            </div>
          )}
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t('workId')}</span>
          <code className="break-all">{work.id}</code>
          <CopyConsoleId
            id={work.id}
            label={t('copyId')}
            copied={t('copied')}
            failed={t('copyFailed')}
          />
        </div>
        <Disclosure label={t('technicalDetails')} className="text-xs text-muted-foreground">
          <p className="mt-2 break-all font-console-mono">
            {t('capturedRevision', { revision: work.revision ?? '' })}
          </p>
          <p>{t('technicalDetailsHelp')}</p>
          {targets.map((row) => (
            <p key={row.identity.incarnation} className="mt-2 break-all font-console-mono">
              {row.identity.id}
              {t('separator')}
              {row.identity.incarnation}
              {t('separator')}
              {row.identity.revision}
            </p>
          ))}
        </Disclosure>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(({ reason, cutoff }) => onConfirm(reason, cutoff))}
            noValidate
            className="space-y-4"
          >
            <fieldset disabled={pending || !!result} className="space-y-4">
              {!!targets.length && (
                <ul className="max-h-48 space-y-3 overflow-y-auto text-sm">
                  {targets.map((row) => (
                    <li key={row.identity.incarnation} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span>{t('jobId')}</span>
                        <code className="break-all">{row.identity.id}</code>
                        <CopyConsoleId
                          id={row.identity.id}
                          label={t('copyId')}
                          copied={t('copied')}
                          failed={t('copyFailed')}
                        />
                      </div>
                      <WorkProjection work={work} values={row.projection} />
                    </li>
                  ))}
                </ul>
              )}
              {operation === 'cleanup' && (
                <Disclosure label={t('additionalLimits')} contentClassName="space-y-3">
                  <FormField
                    control={form.control}
                    name="cutoff"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center gap-1.5">
                          <FormLabel>{t('cutoff', { zone: inputZone.zone })}</FormLabel>
                          <InfoTooltip label={t('cutoffHelp')} />
                        </div>
                        <FormControl>
                          <Input
                            {...field}
                            type="datetime-local"
                            step="1"
                            lang={locale}
                            value={
                              field.value && z.iso.datetime().safeParse(field.value).success
                                ? formatInputInstant(field.value, inputZone.mode)
                                : (field.value ?? '')
                            }
                            onChange={(event) =>
                              field.onChange(
                                parseInputInstant(event.target.value, inputZone.mode) ??
                                  event.target.value
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </Disclosure>
              )}
              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center gap-1.5">
                      <FormLabel>{t('reason')}</FormLabel>
                      <InfoTooltip label={t('reasonHelp')} />
                    </div>
                    <FormControl>
                      <Input
                        {...field}
                        maxLength={250}
                        placeholder={t(`reasonExamples.${operation}`)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </fieldset>
            <ApiErrorAlert error={error} />
            {result}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
                {common(result ? 'close' : 'cancel')}
              </Button>
              {!result && (
                <Button
                  disabled={pending}
                  aria-busy={pending}
                  type="submit"
                  variant={
                    operation === 'cancel' || operation === 'cleanup' ? 'destructive' : 'default'
                  }
                >
                  {t(pending ? 'submitting' : 'confirm')}
                </Button>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
