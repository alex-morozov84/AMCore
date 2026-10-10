import type { WorkPresentation } from '@amcore/shared'

import { BACKGROUND_WORK } from '@/background-work.composition'

/** Compatibility projection of the application work collection; never another registration list. */
export type QueueKind = 'work' | 'wake' | 'extension'
export interface QueueDescriptor {
  readonly presentation?: WorkPresentation
  readonly name: string
  readonly kind: QueueKind
  readonly enabled: boolean
}

export const QUEUE_INVENTORY: readonly QueueDescriptor[] = BACKGROUND_WORK.flatMap(
  ({ definition }) => {
    if (!definition.queue) return []
    const kind: QueueKind =
      definition.kind === 'ordinary' ? 'work' : definition.kind === 'wake' ? 'wake' : 'extension'
    return [
      {
        name: definition.queue.name,
        enabled: definition.queue.enabled,
        kind,
        ...(definition.presentation ? { presentation: definition.presentation } : {}),
      },
    ]
  }
)

/** DI token for the generated enabled name -> Queue map. */
export const QUEUE_REGISTRY = Symbol('QUEUE_REGISTRY')
