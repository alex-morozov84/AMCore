import { type DynamicModule, Module } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { z } from 'zod'

import { aiRunsWork } from '../ai/runs/ai-runs.work'
import { JobName } from '../queue/constants/queues.constant'

import { composeBackgroundWork } from './compose-background-work'
import { ManagedProducer } from './managed-producer'
import { bindWorkHandlers, validateWorkRegistrations } from './registration'
import { defineDurableWork, defineWork, type WorkRegistration } from './work-definition'
import { WorkReadiness } from './work-readiness'

@Module({})
class BusinessModule {}

class BusinessHandler {
  async run(): Promise<void> {
    return undefined
  }
}

function ordinary(enabled = true) {
  return defineWork({
    id: 'image',
    definitionVersion: 1,
    kind: 'ordinary',
    queue: { name: 'image', enabled },
    jobs: {
      render: {
        wireVersion: 2,
        supportedVersions: [{ wireVersion: 1, schema: z.object({}) }],
        schema: z.object({}),
        replay: { kind: 'idempotent', policyVersion: 1 },
        project: () => ({}),
        retention: { completedMs: 1000, failedMs: 1000 },
      },
    },
  })
}

describe('Background-work registration boundary', () => {
  it.each([undefined, 5])(
    'forces wake attempts1 at the producer boundary for options %s',
    async (attempts) => {
      const epoch = '019a1234-1234-7123-8123-123456789012'
      const add = jest.fn(async (_name: string, _data: unknown, _options: unknown) => ({
        id: 'wake-proof',
      }))
      const evalRedis = jest
        .fn()
        .mockResolvedValueOnce(['initialized', epoch])
        .mockImplementationOnce(async () => JSON.stringify(add.mock.calls[0]![1]))
      const queue = {
        keys: {},
        toKey: (id: string) => `amcore:ai-runs:${id}`,
        getBackend: () => ({ client: Promise.resolve({ eval: evalRedis }) }),
        add,
      } as unknown as Queue
      const readiness = new WorkReadiness()
      readiness.open()

      const identity = await new ManagedProducer(aiRunsWork, queue, readiness).add(
        JobName.AI_RUN_WAKE,
        { runId: 'run-1' },
        attempts === undefined ? undefined : { attempts }
      )

      expect(add).toHaveBeenCalledTimes(1)
      expect(add).toHaveBeenCalledWith(
        JobName.AI_RUN_WAKE,
        expect.objectContaining({ payload: { runId: 'run-1' } }),
        expect.objectContaining({ attempts: 1 })
      )
      expect(identity.jobId).toBe('wake-proof')
    }
  )

  it('validates bounded operator labels for both ordinary and durable registrations', () => {
    const presentation = {
      name: { en: 'Image processing', ru: 'Обработка изображений' },
      fields: { productId: { en: 'Product', ru: 'Товар' } },
    }
    expect(defineWork({ ...ordinary(), presentation }).presentation).toEqual(presentation)
    expect(
      defineDurableWork({ id: 'import', definitionVersion: 1, presentation }).presentation
    ).toEqual(presentation)
    expect(() =>
      defineDurableWork({
        id: 'import',
        definitionVersion: 1,
        presentation: { ...presentation, technicalFields: ['undeclaredField'] },
      })
    ).toThrow()
    expect(() =>
      defineDurableWork({
        id: 'import',
        definitionVersion: 1,
        presentation: { ...presentation, name: { ru: 'Импорт' } },
      })
    ).toThrow()
    expect(() =>
      defineDurableWork({
        id: 'import',
        definitionVersion: 1,
        presentation: {
          ...presentation,
          fields: Object.fromEntries(
            Array.from({ length: 9 }, (_, i) => [String(i), { en: 'Field' }])
          ),
        },
      })
    ).toThrow()
  })

  it('requires exact handler coverage, including supported historical wire versions', () => {
    const definition = ordinary()
    const complete = { 'render@1': BusinessHandler, 'render@2': BusinessHandler }
    expect(bindWorkHandlers(definition, complete).exports).toHaveLength(2)
    expect(() =>
      bindWorkHandlers(definition, { 'render@2': BusinessHandler } as typeof complete)
    ).toThrow('Incomplete handler coverage')
    const excessive = { ...complete, 'other@1': BusinessHandler }
    expect(() => bindWorkHandlers(definition, excessive)).toThrow('Incomplete handler coverage')
  })

  it('rejects duplicate identities and queue ownership before invoking any loader', () => {
    const definition = ordinary()
    const entry = {
      definition,
      core: async () => BusinessModule,
      worker: async () => BusinessModule,
    }
    expect(() => validateWorkRegistrations([entry, entry])).toThrow('Duplicate work')
    const other = { ...entry, definition: { ...definition, id: 'other' } }
    expect(() => validateWorkRegistrations([entry, other])).toThrow('Duplicate queue')
  })

  it('rejects missing broker ownership and managed external workers', () => {
    const definition = ordinary()
    const base = { core: async () => BusinessModule, worker: async () => BusinessModule }
    expect(() =>
      validateWorkRegistrations([{ ...base, definition: { ...definition, queue: undefined } }])
    ).toThrow('Missing queue')
    expect(() =>
      validateWorkRegistrations([{ ...base, definition: { ...definition, kind: 'external' } }])
    ).toThrow('External work')
  })

  it('requires durable control without manufacturing a broker processor', async () => {
    const definition = defineDurableWork({ id: 'durable', definitionVersion: 1 })
    const worker = jest.fn(async () => BusinessModule)
    const entry = { definition, core: async () => BusinessModule, worker }
    expect(() => validateWorkRegistrations([entry])).toThrow('Missing durable control port')
    const graph = await composeBackgroundWork(
      [{ ...entry, control: async () => BusinessModule }],
      'worker'
    )
    expect(worker).toHaveBeenCalledTimes(1)
    expect(managedHosts(graph)).toEqual([])
  })

  it('never invokes worker loaders in web and shares one graph per role', async () => {
    const core = jest.fn(async () => BusinessModule)
    const worker = jest.fn(async () => BusinessModule)
    const entries: readonly WorkRegistration[] = [{ definition: ordinary(), core, worker }]
    const graph = await composeBackgroundWork(entries, 'web')
    expect(await composeBackgroundWork(entries, 'web')).toBe(graph)
    expect(core).toHaveBeenCalledTimes(1)
    expect(worker).not.toHaveBeenCalled()
    expect(managedHosts(graph)).toEqual([])
    const workerGraph = await composeBackgroundWork(entries, 'worker')
    expect(worker).toHaveBeenCalledTimes(1)
    expect(managedHosts(workerGraph)).toHaveLength(1)
  })

  it('skips every disabled work loader while retaining its unavailable producer port', async () => {
    const core = jest.fn(async () => BusinessModule)
    const worker = jest.fn(async () => BusinessModule)
    const definition = ordinary(false)
    const graph = await composeBackgroundWork([{ definition, core, worker }], 'worker')
    expect(core).not.toHaveBeenCalled()
    expect(worker).not.toHaveBeenCalled()
    expect(graph.exports).toContain(definition.tokens.producer)
    expect(managedHosts(graph)).toEqual([])
  })
})

function managedHosts(graph: DynamicModule): unknown[] {
  return (graph.providers ?? []).filter(
    (provider) =>
      typeof provider === 'function' && Reflect.hasMetadata('bullmq:processor_metadata', provider)
  )
}
