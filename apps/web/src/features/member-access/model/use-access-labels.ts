'use client'
import { useTranslations } from 'next-intl'
import type { CapabilityCatalogueResponse } from '@amcore/shared'

import { useCatalogueText } from '@/entities/organization-context'

import { capabilityOf } from './access-view'

export interface AccessLabels {
  fieldLabel: (field: string) => string
  /** The words for an item key: the capability label, with the field when the item is one. */
  labelOf: (key: string) => string
}

/** Catalogue-driven wording; a capability without copy reads by its id, a field without copy by its name. */
export function useAccessLabels(
  capabilities: CapabilityCatalogueResponse['capabilities'] | undefined
): AccessLabels {
  const t = useTranslations('memberAccess')
  const text = useCatalogueText()
  const fieldLabel = (field: string): string => {
    const key = `fields.${field}` as Parameters<typeof t.has>[0]
    return t.has(key) ? t(key) : field
  }
  const labelOf = (key: string): string => {
    const found = capabilityOf(
      key,
      (capabilities ?? []).map((entry) => entry.id)
    )
    const capability = capabilities?.find((entry) => entry.id === found?.id)
    const base = (capability && text.capability(capability.labelKey)?.label) ?? found?.id ?? key
    return found?.field ? t('fieldOf', { capability: base, field: fieldLabel(found.field) }) : base
  }
  return { fieldLabel, labelOf }
}
