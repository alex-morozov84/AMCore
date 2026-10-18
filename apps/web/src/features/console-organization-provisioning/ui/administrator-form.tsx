'use client'

import { useTranslations } from 'next-intl'
import { SUPPORTED_LOCALES } from '@amcore/shared'
import { z } from 'zod'

import { useLocalizedForm } from '@/shared/hooks'
import { Button } from '@/shared/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

const schema = z.strictObject({
  firstAdminEmail: z.email().max(254),
  inviteLocale: z.enum(SUPPORTED_LOCALES),
})
export type Administrator = z.infer<typeof schema>
export function ProvisioningAdministratorForm({
  initial,
  onDraft,
  onNext,
  onBack,
}: {
  initial: Administrator
  onDraft?: (value: Administrator) => void
  onNext: (value: Administrator) => void
  onBack: () => void
}) {
  const t = useTranslations('console.organizationProvisioning')
  const form = useLocalizedForm<Administrator>(schema, { defaultValues: initial })
  return (
    <Form {...form}>
      <form
        noValidate
        className="space-y-4"
        onChange={() => onDraft?.(form.getValues())}
        onSubmit={form.handleSubmit(onNext)}
      >
        <p>{t('administratorHelp')}</p>
        <FormField
          control={form.control}
          name="firstAdminEmail"
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
              <FormLabel>{t('language')}</FormLabel>
              <Select
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value)
                  onDraft?.(form.getValues())
                }}
              >
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
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onBack}>
            {t('back')}
          </Button>
          <Button type="submit">{t('next')}</Button>
        </div>
      </form>
    </Form>
  )
}
