import type { WorkReason } from '@amcore/shared'

/** Neutral policy failure: no ADMIN/auth dependency and no raw storage/transport message. */
export class WorkPolicyError extends Error {
  constructor(readonly reason: WorkReason) {
    super(reason)
  }
}
