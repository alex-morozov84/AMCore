import { useTranslations } from 'next-intl'

import { CapabilitySelection, useCatalogueText } from '@/entities/organization-context'
import { Checkbox } from '@/shared/ui/checkbox'
import { Disclosure } from '@/shared/ui/disclosure'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

import { ownKeyOptions, type useOwnKeyForm } from '../model/use-own-key-form'

type Draft = ReturnType<typeof useOwnKeyForm>
export function OwnKeyFields({ draft, disabled }: { draft: Draft; disabled: boolean }) {
  const t = useTranslations('ownApiKeys')
  const text = useCatalogueText()
  const capabilities = ownKeyOptions.map((option) => option.capabilities[0]!)
  return (
    <Form {...draft.form}>
      <div className="space-y-4">
        <FormField
          control={draft.form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('name')}</FormLabel>
              <FormControl>
                <Input {...field} autoComplete="off" disabled={disabled} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <label className="block space-y-2">
          <span>{t('expiry')}</span>
          <Select
            items={['7', '30', '90', '365', 'custom', 'none'].map((value) => ({
              value,
              label: t(`expiryOptions.${value}` as 'expiryOptions.7'),
            }))}
            value={draft.expiry}
            onValueChange={(value) => {
              if (value) draft.setExpiry(value)
            }}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['7', '30', '90', '365', 'custom', 'none'].map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`expiryOptions.${value}` as 'expiryOptions.7')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {draft.expiry === 'custom' && (
          <label className="block space-y-2">
            <span>{t('customExpiry')}</span>
            <Input
              id={draft.expiryInputId}
              aria-invalid={draft.invalidExpiry}
              type="datetime-local"
              value={draft.custom}
              onChange={(event) => draft.setCustom(event.target.value)}
              disabled={disabled}
            />
          </label>
        )}
        <p className="text-sm text-muted-foreground">
          {t('timezone', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
        </p>
        {draft.invalidExpiry && (
          <p role="alert" className="text-destructive">
            {t('invalidExpiry')}
          </p>
        )}
        <p className="text-sm text-muted-foreground">{t('scopeHelp')}</p>
        <CapabilitySelection
          capabilities={capabilities.map((entry) => ({
            ...entry,
            credentials: [...entry.credentials],
            presets: [...entry.presets],
            editableFields: [...entry.editableFields],
          }))}
          configured={(entry) => draft.scopes.includes(`${entry.action}:${entry.subject}`)}
          renderRow={(entry) => {
            const scope = `${entry.action}:${entry.subject}`
            const option = ownKeyOptions.find((item) => item.primaryScope === scope)!
            return (
              <div className="space-y-1">
                <label className="flex items-start gap-2">
                  <Checkbox
                    checked={draft.scopes.includes(scope)}
                    disabled={
                      disabled || (draft.scopes.includes(scope) && !draft.selected.includes(scope))
                    }
                    onCheckedChange={() => draft.toggle(scope)}
                  />
                  <span>
                    {option.capabilities
                      .map(
                        (operation) => text.capability(operation.labelKey)?.label ?? operation.id
                      )
                      .join(', ')}
                  </span>
                </label>
                {draft.scopes.includes(scope) && !draft.selected.includes(scope) && (
                  <p className="text-sm text-muted-foreground">
                    {t(scope === 'read:Organization' ? 'readDependency' : 'teamDependency')}
                  </p>
                )}
              </div>
            )
          }}
        />
        <Disclosure label={t('technicalDetails')}>
          <p className="break-all text-sm">{draft.scopes.join(', ')}</p>
        </Disclosure>
        {draft.scopes.length > 64 && <p role="alert">{t('scopeLimit')}</p>}
        {draft.risky && (
          <label className="flex items-start gap-2">
            <Checkbox
              checked={draft.riskAccepted}
              onCheckedChange={(value) => draft.setRiskAccepted(value === true)}
              disabled={disabled}
            />
            <span>{t('risk')}</span>
          </label>
        )}
      </div>
    </Form>
  )
}
