'use client'

import { useLocale, useTranslations } from 'next-intl'
import { administratorReasonSchema, coerceSupportedLocale, SUPPORTED_LOCALES } from '@amcore/shared'
import { z } from 'zod'

import { useLocalizedForm } from '@/shared/hooks'
import { Button } from '@/shared/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

const schema = z.strictObject({
  email: z.email().max(254),
  inviteLocale: z.enum(SUPPORTED_LOCALES),
  reason: administratorReasonSchema,
})
export type AdministratorFormValue = z.infer<typeof schema>
export function AdministratorInviteForm({
  onNext,
  onBack,
  initial,
}: {
  initial?: AdministratorFormValue
  onNext: (value: AdministratorFormValue) => void
  onBack: () => void
}) {
  const t = useTranslations('console.organizationAdministration')
  const locale = useLocale()
  const form = useLocalizedForm<AdministratorFormValue>(schema, {
    defaultValues: {
      email: '',
      inviteLocale: coerceSupportedLocale(locale),
      reason: '',
      ...initial,
    },
  })
  return (
    <Form {...form}>
      <form noValidate onSubmit={form.handleSubmit(onNext)} className="space-y-4">
        <p>{t('inviteHelp')}</p>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('email')}</FormLabel>
              <FormControl>
                <Input {...field} type="email" autoComplete="email" maxLength={254} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="inviteLocale"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('locale')}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue>
                      {t(String(field.value) === 'ru' ? 'russian' : 'english')}
                    </SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {SUPPORTED_LOCALES.map((language) => (
                    <SelectItem key={language} value={language}>
                      {t(String(language) === 'ru' ? 'russian' : 'english')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="reason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('reason')}</FormLabel>
              <FormControl>
                <Input {...field} maxLength={500} />
              </FormControl>
              <p className="text-sm text-muted-foreground">{t('reasonHelp')}</p>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onBack}>
            {t('back')}
          </Button>
          <Button type="submit">{t('continue')}</Button>
        </div>
      </form>
    </Form>
  )
}
export function AdministratorReasonForm({
  onNext,
  onBack,
  initial,
}: {
  initial?: string
  onNext: (reason: string) => void
  onBack: () => void
}) {
  const t = useTranslations('console.organizationAdministration')
  const reasonSchema = z.strictObject({ reason: administratorReasonSchema })
  const form = useLocalizedForm<z.infer<typeof reasonSchema>>(reasonSchema, {
    defaultValues: { reason: initial ?? '' },
  })
  return (
    <Form {...form}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((value) => onNext(value.reason))}
      >
        <FormField
          control={form.control}
          name="reason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('reason')}</FormLabel>
              <FormControl>
                <Input {...field} maxLength={500} />
              </FormControl>
              <p className="text-sm text-muted-foreground">{t('reasonHelp')}</p>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" type="button" onClick={onBack}>
            {t('back')}
          </Button>
          <Button type="submit">{t('reviewAction')}</Button>
        </div>
      </form>
    </Form>
  )
}
