'use client'

import { useLocale, useTranslations } from 'next-intl'
import {
  coerceSupportedLocale,
  type OrganizationPrepareAccount,
  organizationPrepareAccountSchema,
  SUPPORTED_LOCALES,
} from '@amcore/shared'

import { useLocalizedForm } from '@/shared/hooks'
import { Button } from '@/shared/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

export function SetupAccountForm({
  email,
  onEmail,
  onSubmit,
  disabled = false,
}: {
  email: string
  onEmail: (email: string) => void
  onSubmit: (input: OrganizationPrepareAccount) => void
  disabled?: boolean
}) {
  const t = useTranslations('console.organizationSetup')
  const locale = coerceSupportedLocale(useLocale())
  const form = useLocalizedForm<OrganizationPrepareAccount>(organizationPrepareAccountSchema, {
    defaultValues: { email, locale },
  })
  return (
    <Form {...form}>
      <form noValidate className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
        <p>{t('accountHelp')}</p>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('email')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  onChange={(event) => {
                    field.onChange(event)
                    onEmail(event.target.value)
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="locale"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('locale')}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue>{t(`languages.${field.value ?? locale}`)}</SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {SUPPORTED_LOCALES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {t(`languages.${code}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={disabled}>
          {t('continue')}
        </Button>
      </form>
    </Form>
  )
}
