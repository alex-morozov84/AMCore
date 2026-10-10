import type { DynamicModule, InjectionToken, ModuleMetadata } from '@nestjs/common'
import { Module } from '@nestjs/common'

import type {
  HandlerBindings,
  WorkDefinition,
  WorkHandler,
  WorkRegistration,
} from './work-definition'

export const WORK_REGISTRATIONS = Symbol('WORK_REGISTRATIONS')
export const MANAGED_PRODUCERS = Symbol('MANAGED_PRODUCERS')

/** Business providers bind to factory-created tokens; no second queue inventory. */
export function bindWorkHandlers<D extends WorkDefinition>(
  definition: D,
  bindings: HandlerBindings<NoInfer<D>>,
  imports: NonNullable<ModuleMetadata['imports']> = []
): DynamicModule {
  const keys = Object.keys(definition.tokens.handlers)
  const declared = bindings as Readonly<Record<string, InjectionToken<WorkHandler>>>
  if (keys.length !== Object.keys(bindings).length || keys.some((key) => !declared[key]))
    throw new Error(`Incomplete handler coverage: ${definition.id}`)
  return {
    module: BoundWorkHandlers,
    imports,
    providers: keys.map((key) => ({
      provide: definition.tokens.handlers[key]!,
      useExisting: declared[key]!,
    })),
    exports: Object.values(definition.tokens.handlers),
  }
}

@Module({})
class BoundWorkHandlers {}

export function validateWorkRegistrations(entries: readonly WorkRegistration[]): void {
  if (entries.length > 64) throw new Error('At most 64 works may be registered')
  const ids = new Set<string>()
  const queues = new Set<string>()
  for (const entry of entries) {
    const definition = entry.definition
    if ((definition.kind === 'ordinary' || definition.kind === 'wake') && !definition.queue)
      throw new Error(`Missing queue: ${definition.id}`)
    if (definition.kind === 'durable' && definition.queue)
      throw new Error(`Durable work cannot own a broker queue: ${definition.id}`)
    if (definition.kind === 'external' && entry.worker)
      throw new Error(`External work cannot register a managed worker: ${definition.id}`)
    if (ids.has(definition.id)) throw new Error(`Duplicate work: ${definition.id}`)
    ids.add(definition.id)
    if (definition.queue) {
      if (queues.has(definition.queue.name))
        throw new Error(`Duplicate queue: ${definition.queue.name}`)
      queues.add(definition.queue.name)
    }
    if (!definition.queue?.enabled && definition.queue) continue
    if ((definition.kind === 'ordinary' || definition.kind === 'wake') && !entry.worker)
      throw new Error(`Missing worker binding: ${definition.id}`)
    if (definition.kind === 'durable' && !entry.control)
      throw new Error(`Missing durable control port: ${definition.id}`)
  }
}
