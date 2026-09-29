'use client'

import { useCallback } from 'react'

import { lookupConsoleIdentity } from '@/shared/api/console/identity-lookup-client'
import { IdentityLookup } from '@/shared/ui/identity-lookup'

import type { AuditCopy } from './audit-copy'

export function AuditLookup({
  kind,
  copy,
  onSelect,
}: {
  kind: 'user' | 'organization'
  copy: AuditCopy
  onSelect: (id: string) => void
}) {
  const searchItems = useCallback((term: string) => lookupConsoleIdentity(kind, term), [kind])
  return (
    <IdentityLookup
      inputId={`audit-lookup-${kind}`}
      label={kind === 'user' ? copy.lookupUser : copy.lookupOrganization}
      copy={copy}
      searchItems={searchItems}
      onSelect={onSelect}
    />
  )
}
