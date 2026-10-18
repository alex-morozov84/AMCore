'use client'

import { useTranslations } from 'next-intl'
import { createOrganizationSchema } from '@amcore/shared'
import { z } from 'zod'

import { useLocalizedForm } from '@/shared/hooks'
import { Button } from '@/shared/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

const schema = z.strictObject({
  name: createOrganizationSchema.shape.name,
  slug: z.union([createOrganizationSchema.shape.slug.unwrap(), z.literal('')]),
})
type Company = z.infer<typeof schema>
export function ProvisioningCompanyForm({
  initial,
  onDraft,
  onNext,
  onCancel,
}: {
  initial: Company
  onDraft: (value: Company) => void
  onNext: (value: Company) => void
  onCancel: () => void
}) {
  const t = useTranslations('console.organizationProvisioning')
  const form = useLocalizedForm<Company>(schema, { defaultValues: initial })
  return (
    <Form {...form}>
      <form
        noValidate
        className="space-y-4"
        onChange={() => onDraft(form.getValues())}
        onSubmit={form.handleSubmit(onNext)}
      >
        <p>{t('companyHelp')}</p>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('name')}</FormLabel>
              <FormControl>
                <Input {...field} autoComplete="organization" maxLength={100} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('slug')}</FormLabel>
              <FormControl>
                <Input {...field} autoComplete="off" maxLength={50} />
              </FormControl>
              <p className="text-sm text-muted-foreground">{t('slugHelp')}</p>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('cancelForm')}
          </Button>
          <Button type="submit">{t('next')}</Button>
        </div>
      </form>
    </Form>
  )
}
