import { describe, expect, it } from 'vitest'

import { PRIVATE_EXPOSURE_RUNBOOK_HREF } from './storage-runbook-link'

describe('PRIVATE_EXPOSURE_RUNBOOK_HREF', () => {
  it('keeps the address it had before the shared repository address', () => {
    expect(PRIVATE_EXPOSURE_RUNBOOK_HREF).toBe(
      'https://github.com/alex-morozov84/AMCore/blob/main/docs/operations/runbooks/storage.md#private-exposure'
    )
  })
})
