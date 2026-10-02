'use client'

import { useEffect, useRef } from 'react'
import { useWatch } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { type StorageProbeSettingForm, storageProbeSettingFormSchema } from '@amcore/shared'

import { useLocalizedForm } from '@/shared/hooks'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { InlineSettingField } from '@/shared/ui/inline-setting-field'
import { Input } from '@/shared/ui/input'

export function StorageProbeIntervalForm({
  initialValue,
  disabled,
  busy,
  saving,
  receipt,
  onSave,
  onCancel,
}: {
  initialValue: number
  disabled: boolean
  busy: boolean
  saving: boolean
  receipt?: { value: number; sequence: number }
  onSave: (value: number) => void
  onCancel: () => void
}) {
  const t = useTranslations('console.storageSetting')
  const editing = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const form = useLocalizedForm<StorageProbeSettingForm>(storageProbeSettingFormSchema, {
    defaultValues: { intervalSeconds: initialValue },
  })
  const { reset } = form
  const value = useWatch({ control: form.control, name: 'intervalSeconds' })
  useEffect(() => {
    if (!editing.current && !busy) reset({ intervalSeconds: initialValue })
  }, [initialValue, busy, reset])
  useEffect(() => {
    if (receipt) {
      reset({ intervalSeconds: receipt.value })
      editing.current = false
    }
  }, [receipt, reset])
  function cancel() {
    reset({ intervalSeconds: initialValue })
    editing.current = false
    onCancel()
    inputRef.current?.focus()
  }
  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit((v) => {
          if (!disabled && v.intervalSeconds !== initialValue) onSave(v.intervalSeconds)
        })}
      >
        <FormField
          control={form.control}
          name="intervalSeconds"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="sr-only">{t('label')}</FormLabel>
              <InlineSettingField
                prefix={t('prefix')}
                suffix={t('suffix')}
                help={t('help')}
                changed={value !== initialValue || saving}
                saving={saving}
                disabled={disabled}
                cancelDisabled={busy}
                saveLabel={t('save')}
                savingLabel={t('saving')}
                cancelLabel={t('cancel')}
                onCancel={cancel}
              >
                <FormControl>
                  <Input
                    {...field}
                    ref={(node) => {
                      field.ref(node)
                      inputRef.current = node
                    }}
                    className="h-9 w-24 text-center tabular-nums"
                    type="number"
                    min={30}
                    max={3600}
                    step={1}
                    disabled={busy}
                    value={Number.isNaN(field.value) ? '' : field.value}
                    onChange={(event) => {
                      editing.current = true
                      field.onChange(event.target.valueAsNumber)
                    }}
                  />
                </FormControl>
              </InlineSettingField>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  )
}
