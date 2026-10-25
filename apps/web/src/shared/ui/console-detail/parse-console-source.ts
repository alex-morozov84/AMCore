import { adminQueueNameSchema, integrationIdSchema, scheduledJobIdSchema } from '@amcore/shared'

import type { ConsoleSourceRequest, ConsoleSourceSelection } from './console-source-selection'

import 'server-only'

export type ConsoleSourceParams = Record<string, string | string[] | undefined>
export function parseConsoleSource(
  params: ConsoleSourceParams,
  kind: 'background' | 'scheduled' | 'integration'
): ConsoleSourceRequest {
  if (params.focus === undefined && params.work === undefined && params.state === undefined)
    return {}
  if (kind !== 'background' && (params.work !== undefined || params.state !== undefined))
    return { invalid: true }
  if (params.focus !== undefined && (params.work !== undefined || params.state !== undefined))
    return { invalid: true }
  const work = kind === 'background' && params.work !== undefined
  const value = work ? params.work : params.focus
  const schema =
    kind === 'scheduled'
      ? scheduledJobIdSchema
      : kind === 'integration'
        ? integrationIdSchema
        : adminQueueNameSchema
  const id = schema.safeParse(value)
  if (!id.success || (params.state !== undefined && (!work || params.state !== 'failed')))
    return { invalid: true }
  const selection: ConsoleSourceSelection = {
    kind: work ? 'work' : kind === 'background' ? 'queue' : kind,
    id: id.data,
  }
  if (params.state === 'failed') selection.state = 'failed'
  return { selection }
}
