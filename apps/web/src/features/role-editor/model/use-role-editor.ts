import { useCallback, useMemo, useState } from 'react'
import type { CapabilityCatalogueResponse, RoleDefinitionDetail } from '@amcore/shared'

import type { useRoleDefinition } from '@/entities/organization-context'
import { getErrorCode } from '@/shared/api/errors'

import {
  baselineDraft,
  isDirty,
  requiredAcknowledgments,
  togglePreset,
  toSaveRequest,
} from './role-draft'

import 'client-only'

export type SaveResult =
  | { kind: 'idle' }
  | { kind: 'saved'; accessChanged: boolean }
  | { kind: 'conflict' }
  | { kind: 'unknown' }
  | { kind: 'rejected'; error: unknown }
  | { kind: 'busy' }

type RoleHandle = ReturnType<typeof useRoleDefinition>

/**
 * One role's edit session. The draft stays based on the revision it was started from, so a
 * change made elsewhere shows as a conflict instead of being overwritten, and a dirty draft is
 * never replaced by a background read.
 */
export function useRoleEditor(
  role: RoleHandle,
  detail: RoleDefinitionDetail,
  capabilities: CapabilityCatalogueResponse['capabilities']
) {
  const base = useMemo(() => baselineDraft(detail), [detail])
  const [edited, setEdited] = useState<typeof base>()
  const [result, setResult] = useState<SaveResult>({ kind: 'idle' })
  const draft = edited ?? base
  const dirty = edited !== undefined && isDirty(edited, base)
  const stale = edited !== undefined && edited.revision !== detail.aclVersion
  const needs = requiredAcknowledgments(draft, base, detail.selfHeld, capabilities)
  const change = useCallback(
    (next: Partial<Pick<typeof base, 'name' | 'description'>>) =>
      setEdited({ ...(edited ?? base), ...next }),
    [edited, base]
  )
  const toggle = useCallback(
    (capabilityId: string, presetId: string) =>
      setEdited(togglePreset(edited ?? base, capabilityId, presetId)),
    [edited, base]
  )
  const discard = useCallback(() => {
    setEdited(undefined)
    setResult({ kind: 'idle' })
  }, [])
  const save = useCallback(
    async (acks: { fullControl: boolean; selfHeld: boolean }) => {
      setResult({ kind: 'idle' })
      const outcome = await role.save(toSaveRequest(draft, detail, acks))
      if (outcome.status === 'committed') {
        setEdited(undefined)
        setResult({ kind: 'saved', accessChanged: outcome.followup !== 'ready' })
      } else if (outcome.status === 'rejected')
        setResult(
          getErrorCode(outcome.error) === 'ROLE_DEFINITION_CONFLICT'
            ? { kind: 'conflict' }
            : { kind: 'rejected', error: outcome.error }
        )
      else if (outcome.status === 'unknown') setResult({ kind: 'unknown' })
      else if (outcome.status === 'busy') setResult({ kind: 'busy' })
    },
    [role, draft, detail]
  )
  return { draft, dirty, stale, needs, result, change, toggle, discard, save }
}
