import { UnrecoverableError } from 'bullmq'
import { z } from 'zod'

import { workFailureCodeSchema, type WorkFailureDiagnostic } from '@amcore/shared'

import type { WorkDefinition } from './work-definition'

/** Handler-owned classification; diagnostic recognition never changes permanence. */
export class WorkFailure extends Error {
  readonly permanent: boolean
  constructor(
    readonly code: string,
    options: { readonly permanent: boolean }
  ) {
    super(options.permanent ? 'PERMANENT_FAILURE' : 'TRANSIENT_FAILURE')
    this.name = 'WorkFailure'
    this.permanent = z.boolean().parse(options.permanent)
  }
}

export function isPermanentWorkFailure(error: unknown): boolean {
  return error instanceof UnrecoverableError || (error instanceof WorkFailure && error.permanent)
}

/** Also used by native business-owned adapters, which supply their current failed revision only. */
export function resolveWorkFailure(
  definition: WorkDefinition,
  code: unknown
): WorkFailureDiagnostic | undefined {
  const parsed = workFailureCodeSchema.safeParse(code)
  const catalogue = definition.failureReasons
  if (!parsed.success || !catalogue || !Object.hasOwn(catalogue, parsed.data)) return undefined
  return { code: parsed.data, ...catalogue[parsed.data]! }
}

export function workFailureCode(definition: WorkDefinition, error: unknown): string | undefined {
  return error instanceof WorkFailure ? resolveWorkFailure(definition, error.code)?.code : undefined
}

const reportSchema = z.object({
  report: z.literal('failure'),
  invocationId: z.uuid(),
  failureCode: workFailureCodeSchema,
})

/** Never borrow a previous attempt's reason after retry, recycled IDs or a stale report. */
export function currentWorkFailure(
  definition: WorkDefinition,
  state: string,
  incarnation: string,
  fields: Readonly<Record<string, string | null | undefined>>
): WorkFailureDiagnostic | undefined {
  if (state !== 'failed' || fields.amIncarnation !== incarnation || !fields.amMetadata)
    return undefined
  let metadata: unknown
  try {
    metadata = JSON.parse(fields.amMetadata)
  } catch {
    return undefined
  }
  const parsed = reportSchema.safeParse(metadata)
  if (!parsed.success || parsed.data.invocationId !== fields.amInvocationId) return undefined
  return resolveWorkFailure(definition, parsed.data.failureCode)
}
