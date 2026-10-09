import { z } from 'zod'

import type { ResolvedDeliveryTarget } from './channel-target-resolver.types'

import { strictJson } from '@/common/utils/strict-json'

const targetSchema = z
  .object({
    targetKey: z.string().min(1).max(255),
    targetRef: z.string().min(1).max(255).nullable().optional(),
    destinationSnapshot: z.json().optional(),
    skipReasonCode: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,95}$/)
      .optional(),
  })
  .strict()

/** Fail the transaction rather than silently truncate or overwrite targets. */
export function validateNotificationTargets(targets: readonly ResolvedDeliveryTarget[]): void {
  if (targets.length > 100) throw new Error('Notification channel target limit exceeded')
  const keys = new Set<string>()
  for (const target of targets) {
    targetSchema.parse(target)
    if (keys.has(target.targetKey)) throw new Error('Duplicate notification delivery target')
    keys.add(target.targetKey)
    strictJson(target.destinationSnapshot ?? null, 4096)
  }
}
