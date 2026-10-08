import { useCallback, useState } from 'react'
import { createRoleDefinitionSchema } from '@amcore/shared'

import {
  type OrganizationAccessController,
  useCreateRoleDefinition,
} from '@/entities/organization-context'
import { useLocalizedForm } from '@/shared/hooks/use-localized-form'

import 'client-only'

type Values = { name: string; description?: string | null }

/** What the form shows after a submit; `unknown` means the role may or may not exist. */
export type CreateRoleResult =
  | { kind: 'idle' }
  | { kind: 'rejected'; error: unknown }
  | { kind: 'unknown'; name: string }
  | { kind: 'busy' | 'retired' }

/**
 * Create-role draft: validation is the shared schema, the command is the entity hook. A lost
 * answer is never replayed; the form hands the entered name back so the caller can search for it.
 */
export function useCreateRole(
  controller: OrganizationAccessController,
  onCreated: (roleId: string) => void
) {
  const { create, busy } = useCreateRoleDefinition(controller)
  const form = useLocalizedForm<Values>(createRoleDefinitionSchema, {
    defaultValues: { name: '', description: '' },
  })
  const [result, setResult] = useState<CreateRoleResult>({ kind: 'idle' })
  const submit = useCallback(
    async (values: Values) => {
      setResult({ kind: 'idle' })
      const outcome = await create({ name: values.name, description: values.description })
      if (outcome.status === 'committed') onCreated(outcome.result.role.id)
      else if (outcome.status === 'rejected') setResult({ kind: 'rejected', error: outcome.error })
      else if (outcome.status === 'unknown')
        setResult({ kind: 'unknown', name: values.name.trim() })
      else setResult({ kind: outcome.status })
    },
    [create, onCreated]
  )
  return { form, submit, busy, result, reset: () => setResult({ kind: 'idle' }) }
}
