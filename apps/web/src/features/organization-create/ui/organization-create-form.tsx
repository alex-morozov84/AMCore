'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { type CreateOrganizationInput, createOrganizationSchema } from '@amcore/shared'
import { z } from 'zod'

import { useLocalizedForm } from '@/shared/hooks'
import { Button } from '@/shared/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

const schema = createOrganizationSchema.extend({
  slug: z.union([createOrganizationSchema.shape.slug.unwrap(), z.literal('')]),
})

export function OrganizationCreateForm({
  onSubmit,
  onCancel,
  initial,
}: {
  initial?: CreateOrganizationInput
  onSubmit: (input: CreateOrganizationInput) => void
  onCancel: () => void
}) {
  const t = useTranslations('organizationCreation')
  const form = useLocalizedForm<z.infer<typeof schema>>(schema, {
    defaultValues: { name: initial?.name ?? '', slug: initial?.slug ?? '' },
  })
  const { setFocus } = form
  useEffect(() => {
    setFocus('name')
  }, [setFocus])
  return (
    <Form {...form}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((input) =>
          onSubmit({ name: input.name, ...(input.slug ? { slug: input.slug } : {}) })
        )}
      >
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
                <Input
                  {...field}
                  autoComplete="off"
                  maxLength={50}
                  aria-describedby="organization-slug-help"
                />
              </FormControl>
              <p id="organization-slug-help" className="text-sm text-muted-foreground">
                {t('slugHelp')}
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{t('create')}</Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('cancel')}
          </Button>
        </div>
      </form>
    </Form>
  )
}
