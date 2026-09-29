'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'

import { lookupConsoleIdentity } from '@/shared/api/console/identity-lookup-client'
import { IdentityLookup } from '@/shared/ui/identity-lookup'

export function ConsoleIdentityLookup({
  kind,
  ...props
}: {
  kind: 'user' | 'organization'
  inputId: string
  label: string
  onSelect: (id: string) => void
}) {
  const t = useTranslations('console.identityLookup')
  const searchItems = useCallback((term: string) => lookupConsoleIdentity(kind, term), [kind])
  const copy = {
    lookupSearch: t('lookupSearch'),
    lookupEmpty: t('lookupEmpty'),
    lookupSelect: t('lookupSelect'),
    lookupError: t('lookupError'),
    lookupRefine: t('lookupRefine'),
    loading: t('loading'),
  }
  return <IdentityLookup {...props} searchItems={searchItems} copy={copy} />
}
