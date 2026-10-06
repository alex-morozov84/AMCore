import { useEffect, useRef, useState } from 'react'
import { useWatch } from 'react-hook-form'
import { createInviteSchema, type InviteListItem, inviteRoleIdsSchema } from '@amcore/shared'

import {
  type InvitationManagerOperations,
  type OrganizationAccessController,
  useInvitationRoleChoices,
} from '@/entities/organization-context'
import { useLocalizedForm } from '@/shared/hooks/use-localized-form'

import 'client-only'

const schema = createInviteSchema.extend({ roleIds: inviteRoleIdsSchema })
export type InvitationDraftMode = 'create' | 'repeat' | 'replace'
type Values = { email: string; roleIds: string[] }

/** Draft selections survive role-page changes and background invitation reads. */
export function useInvitationDraft(
  access: OrganizationAccessController,
  operations: InvitationManagerOperations,
  mode: InvitationDraftMode,
  initial?: InviteListItem
) {
  const [snapshot, setSnapshot] = useState(initial)
  const [query, setQuery] = useState({ page: 1, limit: 20, search: '' })
  const roles = useInvitationRoleChoices(access, query)
  const form = useLocalizedForm<Values>(schema, {
    defaultValues: {
      email: initial?.email ?? '',
      roleIds: initial?.roles.filter((r) => r.id !== null).map((r) => r.id!) ?? [],
    },
  })
  const initialized = useRef(Boolean(initial))
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initial?.roles.map((role) => [role.requestedRoleId, role.name ?? role.nameAtIssue]) ?? []
    )
  )
  useEffect(() => {
    if (roles.pending || roles.error || !roles.data || !roles.ready) return
    const data = roles.data
    setNames((previous) => ({
      ...previous,
      ...Object.fromEntries([...data.data, data.defaultRole].map((r) => [r.id, r.name])),
    }))
    if (!initialized.current) {
      initialized.current = true
      form.setValue('roleIds', [data.defaultRole.id])
    }
  }, [roles.pending, roles.error, roles.data, roles.ready, form])
  const selected = useWatch({ control: form.control, name: 'roleIds' })
  async function submit(values: Values) {
    if (mode === 'create') return operations.submit({ kind: 'create', input: values })
    else if (snapshot)
      return operations.submit({
        kind: 'reissue',
        inviteId: snapshot.id,
        input:
          mode === 'repeat'
            ? { mode: 'repeat', expectedGeneration: snapshot.generation }
            : { mode: 'replace', expectedGeneration: snapshot.generation, roleIds: values.roleIds },
      })
  }
  return {
    initializing: !initialized.current && roles.pending,
    form,
    roles,
    query,
    setQuery,
    selected,
    names,
    snapshot,
    submit,
    review(next: InviteListItem) {
      if (snapshot && snapshot.id === next.id) setSnapshot(next)
    },
  }
}
