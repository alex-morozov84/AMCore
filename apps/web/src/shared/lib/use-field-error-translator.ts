'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'

import type { ValidationError } from '../api/types'

/**
 * Translate a server-side field validation error.
 *
 * The API returns `errors[]` entries carrying `field`, an English `message`, an
 * optional Zod `code`, and an optional project `errorCode`. Only the codes are
 * used here: the `message` is developer-facing English and rendering it puts
 * backend prose in a Russian form — the same defect ADR-023 removes from
 * top-level errors.
 *
 * Order: project `errorCode` (shares the `errors.*` catalogue with API errors,
 * so a rule enforced on both sides reads identically) → Zod `code` → generic.
 *
 * Necessarily coarser than the client-side map in `zod-error-map.ts`: the wire
 * format carries no `minimum`/`maximum`/`format`, so "must be at least 8
 * characters" degrades to "this value is not valid". In practice the client
 * schema catches those first; the server path is the backstop.
 */
export function useFieldErrorTranslator() {
  const t = useTranslations()

  return useCallback(
    (error: ValidationError): string => {
      if (error.errorCode) {
        const key = `errors.${error.errorCode}` as Parameters<typeof t.has>[0]
        if (t.has(key)) return t(key)
      }

      switch (error.code) {
        case 'invalid_type':
          return t('validation.required')
        case 'invalid_format':
          return t('validation.pattern')
        case 'too_small':
          return t('validation.invalid')
        case 'too_big':
          return t('validation.invalid')
        case 'invalid_value':
          return t('validation.invalidValue')
        default:
          return t('validation.invalid')
      }
    },
    [t]
  )
}
