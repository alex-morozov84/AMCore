import { registerSchema } from '@amcore/shared'
import { describe, expect, it } from 'vitest'

/**
 * `name` is `optional()` — that means the field may be omitted, not that an
 * empty string passes. `RegisterForm.tsx` defaults it to `''`, which fails
 * this same field's own `min(2)` the moment the form validates on submit.
 * `registerSchema` normalizes a blank string to `undefined` before that
 * check runs (found while writing the Track 7 real-stack E2E register
 * flow — silently blocked every registration attempt).
 */
describe('registerSchema — name', () => {
  const base = { email: 'user@example.com', password: 'Test1234Secure' }

  it('accepts an empty string, treating it the same as omitting the field', () => {
    const result = registerSchema.safeParse({ ...base, name: '' })

    expect(result.success).toBe(true)
    expect(result.success && result.data.name).toBeUndefined()
  })

  it('still rejects a genuinely too-short name', () => {
    const result = registerSchema.safeParse({ ...base, name: 'A' })

    expect(result.success).toBe(false)
  })

  it('still accepts a valid name unchanged', () => {
    const result = registerSchema.safeParse({ ...base, name: 'Jane Doe' })

    expect(result.success).toBe(true)
    expect(result.success && result.data.name).toBe('Jane Doe')
  })

  it('still accepts the field being omitted entirely', () => {
    const result = registerSchema.safeParse(base)

    expect(result.success).toBe(true)
    expect(result.success && result.data.name).toBeUndefined()
  })
})
