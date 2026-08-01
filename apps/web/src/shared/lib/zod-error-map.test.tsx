import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { loginSchema, registerSchema, updateProfileSchema } from '@amcore/shared'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import en from '../../../messages/en.json'
import ru from '../../../messages/ru.json'

import { useZodErrorMap } from './zod-error-map'

const catalogues = { en, ru } as const

function wrapper(locale: keyof typeof catalogues) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={catalogues[locale]}>
        {children}
      </NextIntlClientProvider>
    )
  }
}

/** Parse with the localized map and return the message for the first issue. */
function firstMessage(
  schema: Parameters<typeof z.safeParse>[0] | { safeParse: (v: unknown, p?: unknown) => unknown },
  input: unknown,
  locale: keyof typeof catalogues = 'en'
): string {
  const { result } = renderHook(() => useZodErrorMap(), { wrapper: wrapper(locale) })
  const parsed = (
    schema as {
      safeParse: (v: unknown, p?: unknown) => { error?: { issues: { message: string }[] } }
    }
  ).safeParse(input, { error: result.current })

  return parsed.error!.issues[0]!.message
}

describe('useZodErrorMap', () => {
  it('localizes a missing required field', () => {
    expect(firstMessage(loginSchema, {})).toBe('This field is required.')
    expect(firstMessage(loginSchema, {}, 'ru')).toBe('Заполните это поле.')
  })

  it('localizes an invalid email', () => {
    expect(firstMessage(loginSchema, { email: 'nope', password: 'x' })).toBe(
      'Enter a valid email address.'
    )
    expect(firstMessage(loginSchema, { email: 'nope', password: 'x' }, 'ru')).toBe(
      'Введите корректный email.'
    )
  })

  it('localizes a too-short string and interpolates the bound', () => {
    const message = firstMessage(
      registerSchema,
      { email: 'a@b.co', password: 'short', name: 'Jane' },
      'en'
    )
    expect(message).toBe('Must be at least 8 characters.')
  })

  it('localizes an out-of-enum value', () => {
    expect(firstMessage(updateProfileSchema, { locale: 'de' })).toBe(
      'Choose one of the allowed values.'
    )
  })

  it('prefers a project errorCode over the generic mapping', () => {
    const schema = z.string().superRefine((_value, ctx) => {
      ctx.addIssue({
        code: 'custom',
        params: { errorCode: 'API_KEY_SCOPE_UNKNOWN_ACTION' },
      })
    })

    // Reuses the `errors.*` catalogue that API errors use, so the same rule
    // reads identically whether it failed on the client or on the server.
    expect(firstMessage(schema, 'bogus:Thing')).toBe('Unknown scope action.')
    expect(firstMessage(schema, 'bogus:Thing', 'ru')).toBe('Неизвестное действие в скоупе.')
  })

  it('falls back generically for an unknown custom issue', () => {
    const schema = z.string().superRefine((_value, ctx) => {
      ctx.addIssue({ code: 'custom' })
    })

    expect(firstMessage(schema, 'x')).toBe('This value is not valid.')
  })

  it('does not depend on Zod global locale state', () => {
    // The whole point of the per-parse map: two locales resolved from the same
    // schema in the same process, which `z.config(z.locales.*)` cannot do.
    expect(firstMessage(loginSchema, {}, 'en')).toBe('This field is required.')
    expect(firstMessage(loginSchema, {}, 'ru')).toBe('Заполните это поле.')
    expect(firstMessage(loginSchema, {}, 'en')).toBe('This field is required.')
  })
})
