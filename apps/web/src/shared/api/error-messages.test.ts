import {
  ApiKeyScopeErrorCode,
  AuthErrorCode,
  InfrastructureErrorCode,
  InviteErrorCode,
  ResourceErrorCode,
  SUPPORTED_LOCALES,
} from '@amcore/shared'
import { describe, expect, it } from 'vitest'

import en from '../../../messages/en.json'
import ru from '../../../messages/ru.json'

import { ClientErrorCode } from './error-codes'

const catalogues: Record<string, { errors: Record<string, string> }> = { en, ru }

/**
 * Every machine-readable code the backend can emit. Derived from the shared
 * enums rather than restated, so adding a code to `@amcore/shared` without
 * translating it fails this test instead of silently degrading the UI to a
 * generic message — which is exactly how the original gap went unnoticed.
 */
const backendCodes = [
  ...Object.values(AuthErrorCode),
  ...Object.values(ResourceErrorCode),
  ...Object.values(InfrastructureErrorCode),
  ...Object.values(ApiKeyScopeErrorCode),
  ...Object.values(InviteErrorCode),
]

const clientCodes = Object.values(ClientErrorCode)

describe('API error message coverage', () => {
  it('derives a non-trivial set of backend codes', () => {
    // Guards the guard: if the enums were ever renamed or the import shape
    // changed, the loops below would vacuously pass over an empty list.
    expect(backendCodes.length).toBeGreaterThan(20)
    expect(new Set(backendCodes).size).toBe(backendCodes.length)
  })

  it('has no collision between client and backend codes', () => {
    const overlap = clientCodes.filter((code) => backendCodes.includes(code as never))
    expect(overlap).toEqual([])
  })

  it.each(SUPPORTED_LOCALES)('%s translates every backend error code', (locale) => {
    const messages = catalogues[locale]!.errors
    const missing = backendCodes.filter((code) => !(code in messages))

    expect(missing).toEqual([])
  })

  it.each(SUPPORTED_LOCALES)('%s translates every client error code', (locale) => {
    const messages = catalogues[locale]!.errors
    const missing = clientCodes.filter((code) => !(code in messages))

    expect(missing).toEqual([])
  })

  it.each(SUPPORTED_LOCALES)('%s has no orphaned error message', (locale) => {
    const known = new Set<string>([...backendCodes, ...clientCodes, 'correlationHint'])
    const orphaned = Object.keys(catalogues[locale]!.errors).filter((key) => !known.has(key))

    // An orphan is either a typo or a code the backend has removed; both mean
    // the catalogue and the contract have drifted.
    expect(orphaned).toEqual([])
  })

  it.each(SUPPORTED_LOCALES)('%s never leaves an error message blank', (locale) => {
    const blank = Object.entries(catalogues[locale]!.errors)
      .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
      .map(([key]) => key)

    expect(blank).toEqual([])
  })
})
