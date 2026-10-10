import type { z } from 'zod'

import { imagePayload, ImageWorkHandler } from '../../../recipes/background-work/image-work'
import type { PrismaClient } from '../../../src/generated/prisma/client'
import type { WorkInvocation } from '../../../src/infrastructure/background-work'

export {
  imagePayload,
  imageRegistration,
  imageWork,
} from '../../../recipes/background-work/image-work'

/** Fault instrumentation wraps the unchanged public business handler. */
export class ImageFixtureHandler extends ImageWorkHandler {
  calls = 0
  references: string[] = []
  constructor(
    db: Pick<PrismaClient, '$queryRaw'>,
    private readonly afterCommit: (
      call: number,
      context: WorkInvocation
    ) => Promise<void> = async () => undefined
  ) {
    super(db)
  }

  override async run(
    payload: z.infer<typeof imagePayload>,
    context: WorkInvocation
  ): Promise<string> {
    const reference = await super.run(payload, context)
    this.references.push(reference)
    await this.afterCommit(++this.calls, context)
    return reference
  }
}
