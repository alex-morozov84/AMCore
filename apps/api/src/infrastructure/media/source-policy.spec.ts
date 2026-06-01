import { type ImageInspection, MediaProcessingError, type SourcePolicy } from './media.types'
import { AVATAR_SOURCE_POLICY } from './presets/avatar.preset'
import { assertSourceAllowed } from './source-policy'

const inspection = (overrides: Partial<ImageInspection> = {}): ImageInspection => ({
  format: 'png',
  width: 256,
  height: 256,
  pages: 1,
  animated: false,
  hasAlpha: false,
  ...overrides,
})

/** Run `fn`, returning the thrown error (so assertions stay unconditional). */
const catchSync = (fn: () => void): unknown => {
  try {
    fn()
  } catch (err) {
    return err
  }
  throw new Error('expected function to throw')
}

describe('assertSourceAllowed', () => {
  it('accepts an allowed still format', () => {
    expect(() =>
      assertSourceAllowed(inspection({ format: 'jpeg' }), AVATAR_SOURCE_POLICY)
    ).not.toThrow()
    expect(() =>
      assertSourceAllowed(inspection({ format: 'webp' }), AVATAR_SOURCE_POLICY)
    ).not.toThrow()
  })

  it('rejects a format outside the preset allowlist with UNSUPPORTED_IMAGE', () => {
    for (const format of ['gif', 'avif'] as const) {
      const err = catchSync(() => assertSourceAllowed(inspection({ format }), AVATAR_SOURCE_POLICY))
      expect(err).toBeInstanceOf(MediaProcessingError)
      expect((err as MediaProcessingError).code).toBe('UNSUPPORTED_IMAGE')
    }
  })

  it('rejects animated input when the preset disallows animation (avatar)', () => {
    const err = catchSync(() =>
      assertSourceAllowed(
        inspection({ format: 'webp', animated: true, pages: 12 }),
        AVATAR_SOURCE_POLICY
      )
    )
    expect(err).toBeInstanceOf(MediaProcessingError)
    expect((err as MediaProcessingError).code).toBe('UNSUPPORTED_IMAGE')
  })

  it('accepts animated input when a preset opts in', () => {
    const policy: SourcePolicy = { allowedFormats: ['webp'], allowAnimated: true }
    expect(() =>
      assertSourceAllowed(inspection({ format: 'webp', animated: true }), policy)
    ).not.toThrow()
  })
})
