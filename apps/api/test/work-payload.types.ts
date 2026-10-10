import { z } from 'zod'

import {
  bindWorkHandlers,
  defineOrdinaryWork,
  ManagedProducer,
  type WorkHandler,
} from '../src/infrastructure/background-work'
import type { WorkPayload } from '../src/infrastructure/background-work/work-definition'

const work = defineOrdinaryWork({
  id: 'payload-types',
  definitionVersion: 1,
  queue: { name: 'payload-types', enabled: true },
  jobs: {
    run: {
      wireVersion: 2,
      schema: z.object({ raw: z.string() }),
      normalize: (wire: { raw: string }) => ({ value: wire.raw.length }),
      supportedVersions: [
        {
          wireVersion: 1,
          schema: z.object({ old: z.number() }),
          normalize: (wire: { old: number }) => ({ value: wire.old }),
        },
      ],
      replay: { kind: 'idempotent', policyVersion: 1 },
      project: (payload: { value: number }) => ({ value: payload.value }),
      retention: { completedMs: 1000, failedMs: 1000 },
    },
  },
})

export function verifyTypes(producer: ManagedProducer<typeof work>): void {
  void producer.add('run', { raw: 'wire' })
  // @ts-expect-error Producers accept wire input, never normalized business payload.
  void producer.add('run', { value: 4 })
  const payload: WorkPayload<typeof work.jobs.run> = { value: 4 }
  // @ts-expect-error The common handler payload has no wire-only field.
  payload.raw
  const handler: WorkHandler<typeof payload> = { run: async ({ value }) => value }
  void handler
}

const invalidVersion = {
  ...work.jobs.run,
  supportedVersions: [
    {
      wireVersion: 1,
      schema: z.object({ old: z.number() }),
      normalize: (wire: { old: number }) => ({ incompatible: wire.old }),
    },
  ],
}
const invalidVersionDefinition = {
  id: 'invalid',
  definitionVersion: 1,
  queue: { name: 'invalid', enabled: true },
  jobs: { run: invalidVersion },
}
// @ts-expect-error Retained versions must normalize to the current business payload.
defineOrdinaryWork(invalidVersionDefinition)
const invalidAsync = {
  ...work.jobs.run,
  normalize: async (wire: { raw: string }) => ({ value: wire.raw.length }),
}
const invalidAsyncDefinition = {
  id: 'async',
  definitionVersion: 1,
  queue: { name: 'async', enabled: true },
  jobs: { run: invalidAsync },
}
// @ts-expect-error Normalization is synchronous.
defineOrdinaryWork(invalidAsyncDefinition)
const invalidInput = {
  ...work.jobs.run,
  normalize: (wire: { wrong: number }) => ({ value: wire.wrong }),
}
const invalidInputDefinition = {
  id: 'wrong-input',
  definitionVersion: 1,
  queue: { name: 'wrong-input', enabled: true },
  jobs: { run: invalidInput },
}
// @ts-expect-error Normalizer input must match the wire schema output.
defineOrdinaryWork(invalidInputDefinition)
const invalidRetainedInput = {
  ...work.jobs.run,
  supportedVersions: [
    {
      wireVersion: 1,
      schema: z.object({ old: z.number() }),
      normalize: (wire: { wrong: number }) => ({ value: wire.wrong }),
    },
  ],
}
const invalidRetainedDefinition = {
  id: 'retained-input',
  definitionVersion: 1,
  queue: { name: 'retained-input', enabled: true },
  jobs: { run: invalidRetainedInput },
}
// @ts-expect-error A retained normalizer accepts its own wire schema output.
defineOrdinaryWork(invalidRetainedDefinition)

class CompatibleHandler implements WorkHandler<WorkPayload<typeof work.jobs.run>> {
  async run(payload: WorkPayload<typeof work.jobs.run>): Promise<number> {
    return payload.value
  }
}
class WireOnlyHandler {
  async run(payload: { raw: string }): Promise<string> {
    return payload.raw
  }
}
bindWorkHandlers(work, { 'run@1': CompatibleHandler, 'run@2': CompatibleHandler })
// @ts-expect-error Both versions require the normalized handler payload.
bindWorkHandlers(work, { 'run@1': WireOnlyHandler, 'run@2': CompatibleHandler })
const invalidProject = {
  ...work.jobs.run,
  project: (payload: { raw: string }) => ({ raw: payload.raw }),
}
const invalidProjectionDefinition = {
  id: 'invalid-project',
  definitionVersion: 1,
  queue: { name: 'invalid-project', enabled: true },
  jobs: { run: invalidProject },
}
// @ts-expect-error Projection consumes normalized values, not wire values.
defineOrdinaryWork(invalidProjectionDefinition)
