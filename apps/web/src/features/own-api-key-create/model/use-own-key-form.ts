import { type BaseSyntheticEvent, useId, useState } from 'react'
import {
  apiKeyScopeOptions,
  CAPABILITY_CATALOGUE,
  createApiKeySchema,
  selectedApiKeyScopes,
} from '@amcore/shared'

import type { OwnApiKeyController } from '@/entities/api-key'
import { useLocalizedForm } from '@/shared/hooks/use-localized-form'

import 'client-only'

export const ownKeyOptions = apiKeyScopeOptions(CAPABILITY_CATALOGUE)
const formSchema = createApiKeySchema.pick({ name: true })
export function resolveOwnKeyExpiry(
  choice: string,
  custom: string,
  now = Date.now()
): string | undefined {
  if (choice === 'none') return undefined
  if (choice !== 'custom') return new Date(now + Number(choice) * 86400000).toISOString()
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(custom)
  if (!match) throw new Error('INVALID_EXPIRY')
  const [, year, month, day, hour, minute] = match.map(Number)
  const date = new Date(year!, month! - 1, day, hour, minute)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month! - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getTime() <= now
  )
    throw new Error('INVALID_EXPIRY')
  return date.toISOString()
}
export function useOwnKeyForm(
  controller: OwnApiKeyController,
  organizationId: string,
  organizationName?: string
) {
  const expiryInputId = useId()
  const form = useLocalizedForm<{ name: string }>(formSchema, { defaultValues: { name: '' } })
  const [selected, setSelected] = useState<string[]>([])
  const [expiry, setExpiry] = useState('30')
  const [custom, setCustom] = useState('')
  const [riskAccepted, setRiskAccepted] = useState(false)
  const [invalidExpiry, setInvalidExpiry] = useState(false)
  const [previousTarget, setPreviousTarget] = useState(organizationId)
  if (previousTarget !== organizationId) {
    setPreviousTarget(organizationId)
    setSelected([])
    setRiskAccepted(false)
  }
  const scopes = selectedApiKeyScopes(ownKeyOptions, selected)
  const risky = CAPABILITY_CATALOGUE.some(
    (entry) =>
      'risk' in entry &&
      entry.risk === 'fullControl' &&
      scopes.includes(`${entry.action}:${entry.subject}`)
  )
  const valid = scopes.length > 0 && scopes.length <= 64 && (!risky || riskAccepted)
  const submit = async (event?: BaseSyntheticEvent, verifyTarget?: () => Promise<boolean>) => {
    event?.preventDefault()
    const parsed = formSchema.safeParse(form.getValues())
    if (!parsed.success) {
      await form.trigger('name')
      return
    }
    const { name } = parsed.data
    if (!valid) return
    let expiresAt
    try {
      expiresAt = resolveOwnKeyExpiry(expiry, custom)
      setInvalidExpiry(false)
    } catch {
      setInvalidExpiry(true)
      document.getElementById(expiryInputId)?.focus()
      return
    }
    await controller.create(
      { name, organizationId, scopes, ...(expiresAt && { expiresAt }) },
      organizationName,
      verifyTarget
    )
  }
  const reset = () => {
    form.reset()
    setSelected([])
    setExpiry('30')
    setCustom('')
    setRiskAccepted(false)
    setInvalidExpiry(false)
  }
  return {
    form,
    expiryInputId,
    selected,
    toggle: (scope: string) => {
      setSelected((current) =>
        current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope]
      )
      setRiskAccepted(false)
    },
    expiry,
    setExpiry: (value: string) => {
      setExpiry(value)
      setInvalidExpiry(false)
    },
    custom,
    setCustom: (value: string) => {
      setCustom(value)
      setInvalidExpiry(false)
    },
    riskAccepted,
    setRiskAccepted,
    invalidExpiry,
    risky,
    scopes,
    valid,
    submit,
    reset,
  }
}
