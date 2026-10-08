'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import type { OrganizationAccessController } from '@/entities/organization-context'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

import { useCreateRole } from '../model/use-create-role'

/** Creates an empty role, then hands its id to the page so it can open the editor. */
export function CreateRoleDialog({
  controller,
  disabled,
  onCreated,
  onSearchName,
}: {
  controller: OrganizationAccessController
  disabled: boolean
  onCreated: (roleId: string) => void
  onSearchName: (name: string) => void
}) {
  const t = useTranslations('organizationRoles')
  const [open, setOpen] = useState(false)
  const { form, submit, busy, result, reset } = useCreateRole(controller, (roleId) => {
    setOpen(false)
    onCreated(roleId)
  })
  const change = (next: boolean) => {
    setOpen(next)
    if (!next) {
      form.reset()
      reset()
    }
  }
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger render={<Button disabled={disabled} />}>{t('create')}</DialogTrigger>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('createTitle')}</DialogTitle>
          <DialogDescription>{t('createDescription')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(submit)}>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('nameLabel')}</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" disabled={busy} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('descriptionLabel')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      autoComplete="off"
                      disabled={busy}
                    />
                  </FormControl>
                  <p className="text-sm text-muted-foreground">{t('descriptionHelp')}</p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <CreateResult
              result={result}
              onSearch={(name) => {
                setOpen(false)
                onSearchName(name)
              }}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => change(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? t('creating') : t('createSubmit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function CreateResult({
  result,
  onSearch,
}: {
  result: ReturnType<typeof useCreateRole>['result']
  onSearch: (name: string) => void
}) {
  const t = useTranslations('organizationRoles')
  if (result.kind === 'idle') return null
  if (result.kind === 'rejected') return <ApiErrorAlert error={result.error} />
  if (result.kind === 'unknown')
    return (
      <div role="status" className="space-y-2">
        <p>{t('createUnknown')}</p>
        <Button type="button" variant="outline" onClick={() => onSearch(result.name)}>
          {t('createCheck')}
        </Button>
      </div>
    )
  return <p role="status">{result.kind === 'busy' ? t('createBusy') : t('createRetired')}</p>
}
