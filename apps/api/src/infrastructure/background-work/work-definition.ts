import type { Abstract, ModuleMetadata, Type } from '@nestjs/common'
import type { Job } from 'bullmq'
import { z } from 'zod'

import {
  type WorkFailureReasons,
  workFailureReasonsSchema,
  type WorkPresentation,
  workPresentationSchema,
} from '@amcore/shared'

import type { PayloadVersion } from './work-payload'

export type WorkKind = 'ordinary' | 'wake' | 'external' | 'durable'
export type ReplayPolicy =
  | { readonly kind: 'idempotent'; readonly policyVersion: number }
  | {
      readonly kind: 'provider-window'
      readonly policyVersion: number
      readonly recipe: 'queued-email'
    }
  | { readonly kind: 'unsupported'; readonly policyVersion: number }

export interface JobBinding<
  S extends z.ZodType = z.ZodType,
  P = z.output<S>,
> extends PayloadVersion<S, P> {
  readonly supportedVersions?: readonly PayloadVersion<z.ZodType, P>[]
  readonly replay: ReplayPolicy
  project(payload: P): Readonly<Record<string, string | number | boolean>>
  readonly retention: { readonly completedMs: number; readonly failedMs: number }
}

export interface WorkDefinition<J extends Record<string, JobBinding> = Record<string, JobBinding>> {
  readonly id: string
  readonly definitionVersion: number
  readonly failureReasons?: WorkFailureReasons
  readonly presentation?: WorkPresentation
  readonly kind: WorkKind
  readonly queue?: { readonly name: string; readonly enabled: boolean }
  readonly jobs: J
  readonly legacy?: { readonly kind: 'wake-hint' }
  readonly tokens: {
    readonly producer: symbol
    readonly handlers: Readonly<Record<string, symbol>>
    readonly reader: symbol
    readonly control: symbol
  }
}

/** The current and retained versions share the current binding's normalized payload. */
export type WorkPayload<B extends PayloadVersion> = B extends {
  normalize: (...args: never[]) => infer P
}
  ? P
  : z.output<B['schema']>

type CheckedVersion<V extends PayloadVersion, P> =
  WorkPayload<V> extends P ? V & { normalize?(wire: z.output<V['schema']>): P } : never

type CheckedJobs<J extends Record<string, JobBinding>> = {
  [K in keyof J]: J[K] & {
    normalize?(wire: z.output<J[K]['schema']>): Exclude<WorkPayload<J[K]>, PromiseLike<unknown>>
    project(payload: WorkPayload<J[K]>): Readonly<Record<string, string | number | boolean>>
    supportedVersions?: readonly CheckedVersion<
      NonNullable<J[K]['supportedVersions']>[number],
      WorkPayload<J[K]>
    >[]
  }
}

type ModuleImport = NonNullable<ModuleMetadata['imports']>[number]

/** Lazy loaders keep worker implementations out of the web import graph. */
export interface WorkRegistration {
  readonly definition: WorkDefinition
  readonly core: () => Promise<ModuleImport>
  readonly worker?: () => Promise<ModuleImport>
  readonly control?: () => Promise<ModuleImport>
}

export interface WorkInvocation {
  readonly workId: string
  readonly jobId: string
  readonly incarnation: string
  readonly invocationId: string
  readonly signal: AbortSignal
  /** Present only after approved provider-window reservation and broker admission. */
  readonly effect?: { send(): Promise<void> }
}

export interface WorkHandler<Input = unknown> {
  run(payload: Input, context: WorkInvocation): Promise<unknown>
  /** Pure preparation for an approved immutable provider recipe; performs no external effect. */
  prepareRequest?(payload: Input, context: WorkInvocation): Promise<string>
  /** Worker-local observability only; these hooks never authorize work or commands. */
  onFailed?(job: Job, error: Error): void
  onError?(error: Error): void
  /** Explicit built-in compatibility: old wake hints carry no business identity or work. */
  runLegacyWake?(): Promise<unknown>
}

type SupportedVersion<B extends JobBinding> = B extends {
  supportedVersions: readonly { wireVersion: infer V extends number }[]
}
  ? B['wireVersion'] | V
  : B['wireVersion']

export type HandlerKey<D extends WorkDefinition> = {
  [K in keyof D['jobs'] & string]: `${K}@${SupportedVersion<D['jobs'][K]>}`
}[keyof D['jobs'] & string]

type HandlerToken<T> = string | symbol | Type<T> | Abstract<T>

export type HandlerBindings<D extends WorkDefinition> = {
  readonly [K in HandlerKey<D>]: HandlerToken<
    WorkHandler<
      K extends `${infer Name}@${number}`
        ? Name extends keyof D['jobs']
          ? WorkPayload<D['jobs'][Name]>
          : never
        : never
    >
  >
}

export function jobVersions(binding: JobBinding): readonly PayloadVersion[] {
  return [
    { wireVersion: binding.wireVersion, schema: binding.schema, normalize: binding.normalize },
    ...(binding.supportedVersions ?? []),
  ]
}

const workId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/)

export function defineWork<const J extends Record<string, JobBinding>>(
  descriptor: Omit<WorkDefinition<J>, 'tokens'> & { jobs: NoInfer<CheckedJobs<J>> }
): WorkDefinition<J> {
  const failureReasons = descriptor.failureReasons
    ? workFailureReasonsSchema.parse(descriptor.failureReasons)
    : undefined
  if (failureReasons) {
    for (const reason of Object.values(failureReasons)) {
      Object.freeze(reason.title)
      if (reason.nextStep) Object.freeze(reason.nextStep)
      Object.freeze(reason)
    }
    Object.freeze(failureReasons)
  }
  if (descriptor.presentation) workPresentationSchema.parse(descriptor.presentation)
  workId.parse(descriptor.id)
  if (descriptor.queue) workId.parse(descriptor.queue.name)
  z.number().int().min(1).parse(descriptor.definitionVersion)
  if (descriptor.legacy && descriptor.kind !== 'wake')
    throw new Error('Only wake hints support legacy dispatch')
  const jobs = Object.entries(descriptor.jobs)
  if (jobs.length > 32) throw new Error('A work supports at most 32 job bindings')
  const handlers: Record<string, symbol> = {}
  for (const [key, job] of jobs) {
    workId.parse(key)
    z.number().int().min(1).parse(job.replay.policyVersion)
    for (const duration of [job.retention.completedMs, job.retention.failedMs])
      z.number()
        .int()
        .min(1)
        .max(30 * 86400000)
        .parse(duration)
    for (const version of jobVersions(job)) {
      z.number().int().min(1).parse(version.wireVersion)
      const handlerKey = `${key}@${version.wireVersion}`
      if (handlers[handlerKey]) throw new Error(`Duplicate job version: ${handlerKey}`)
      handlers[handlerKey] = Symbol(`${descriptor.id}:${handlerKey}`)
    }
  }
  if (Object.keys(handlers).length > 32)
    throw new Error('A work supports at most 32 job/version bindings')
  return Object.freeze({
    ...descriptor,
    ...(failureReasons ? { failureReasons } : {}),
    jobs: Object.freeze(descriptor.jobs),
    tokens: Object.freeze({
      producer: Symbol(`${descriptor.id}:producer`),
      handlers: Object.freeze(handlers),
      reader: Symbol(`${descriptor.id}:reader`),
      control: Symbol(`${descriptor.id}:control`),
    }),
  })
}

export function defineOrdinaryWork<const J extends Record<string, JobBinding>>(
  descriptor: Omit<WorkDefinition<J>, 'tokens' | 'kind'> & { jobs: NoInfer<CheckedJobs<J>> }
): WorkDefinition<J> {
  if (!descriptor.queue) throw new Error('Ordinary work requires a queue')
  return defineWork<J>({ ...descriptor, kind: 'ordinary' })
}

export function defineDurableWork(
  descriptor: Pick<WorkDefinition, 'id' | 'definitionVersion' | 'presentation' | 'failureReasons'>
): WorkDefinition<Record<string, never>> {
  return defineWork({ ...descriptor, kind: 'durable', jobs: {} })
}
