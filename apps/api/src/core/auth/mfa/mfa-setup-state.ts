import { z } from 'zod'

import type { Prisma } from '../../../generated/prisma/client.js'

import { flowData } from './mfa-flow-state.js'

const setup = z
  .object({ generation: z.number().int().positive(), acknowledged: z.boolean() })
  .strict()
export function readSetupState(data: Prisma.JsonValue): z.infer<typeof setup> | null {
  const parsed = setup.safeParse(flowData(data).setup)
  return parsed.success ? parsed.data : null
}
