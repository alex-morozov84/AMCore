import { existsSync } from 'node:fs'
import path from 'node:path'

import { OWNERSHIP_CODES, ownershipError } from './ownership-errors.mjs'

export function assertLocaleOwnershipApplied(root, validation) {
  const residuals = [...validation.projection.removed].filter((pathname) =>
    existsSync(path.join(root, pathname))
  )
  if (!residuals.length) return
  throw ownershipError(
    OWNERSHIP_CODES.RESIDUAL,
    `locale projection left removed paths: ${residuals.join(', ')}`,
    residuals
  )
}
