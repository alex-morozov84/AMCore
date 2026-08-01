'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import type { $ZodRawIssue } from 'zod/v4/core'

/**
 * Localized validation messages, resolved per parse.
 *
 * Zod's own `z.config(z.locales.*)` is deliberately **not** used. That setting
 * is process-global and cannot be scoped to a request or a render
 * (colinhacks/zod#4986, closed without adding per-request support), so it
 * cannot represent two live locales at once — and on the server it would be a
 * cross-request race. A per-parse error map has neither problem: it is passed
 * into the parse call itself.
 *
 * Two kinds of issue, one path each:
 * - **project issues** — a `superRefine` that attaches `params.errorCode`
 *   reuses the `errors.<CODE>` catalogue that API errors already use, so a
 *   rule enforced on both sides reads identically wherever it fires;
 * - **built-in Zod issues** — mapped to `validation.*` keys.
 *
 * Requires that no schema sets a literal `message`: Zod's precedence is
 * schema-level → per-parse → global → locale, so a hardcoded message silently
 * defeats this map. Verified empirically while building this.
 */
export function useZodErrorMap() {
  const t = useTranslations()

  return useCallback(
    (issue: $ZodRawIssue): string => {
      const errorCode = (issue as { params?: { errorCode?: string } }).params?.errorCode
      if (errorCode) {
        const key = `errors.${errorCode}` as Parameters<typeof t.has>[0]
        if (t.has(key)) return t(key)
      }

      switch (issue.code) {
        case 'invalid_type':
          // Zod reports a missing field as an `undefined` input rather than a
          // distinct code, so "required" has to be derived here.
          return issue.input === undefined ? t('validation.required') : t('validation.invalidType')

        case 'invalid_format':
          if (issue.format === 'email') return t('validation.email')
          return t('validation.pattern')

        case 'too_small':
          return issue.origin === 'string'
            ? t('validation.tooShort', { min: Number(issue.minimum) })
            : t('validation.tooSmall', { min: Number(issue.minimum) })

        case 'too_big':
          return issue.origin === 'string'
            ? t('validation.tooLong', { max: Number(issue.maximum) })
            : t('validation.tooBig', { max: Number(issue.maximum) })

        case 'invalid_value':
          return t('validation.invalidValue')

        default:
          return t('validation.invalid')
      }
    },
    [t]
  )
}
