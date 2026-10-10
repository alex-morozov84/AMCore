import { Test, TestingModule } from '@nestjs/testing'
import type { Queue } from 'bullmq'
import { EventEmitter } from 'events'
import { PinoLogger } from 'nestjs-pino'

import { NotFoundException } from '../../common/exceptions'
import { MANAGED_PRODUCERS } from '../background-work/registration'

import { QUEUE_REGISTRY } from './constants/queue-inventory.constant'
import { QueueName } from './constants/queues.constant'
import { QueueService } from './queue.service'

import { MetricsService } from '@/infrastructure/observability'

describe('QueueService', () => {
  let managedAdd: jest.Mock
  let service: QueueService
  let defaultQueue: jest.Mocked<Queue>
  let emailQueue: jest.Mocked<Queue>
  let notificationsQueue: jest.Mocked<Queue>
  let aiRunsQueue: jest.Mocked<Queue>
  let mockLogger: jest.Mocked<PinoLogger>
  let metrics: jest.Mocked<Pick<MetricsService, 'incQueueEvent' | 'incRedisClientEvent'>>

  beforeEach(async () => {
    // Create mock queues. EventEmitter-based so the synchronous `queue.on('error')`
    // wiring in onModuleInit works; `getBackend().client` resolves to a
    // raw-client emitter for the fire-and-forget `reconnecting` listener
    // (BullMQ 6's replacement for the removed `Queue#client`).
    const createMockQueue = (): jest.Mocked<Queue> =>
      Object.assign(new EventEmitter(), {
        add: jest.fn(),
        getJob: jest.fn(),
        getActive: jest.fn(),
        getFailed: jest.fn(),
        pause: jest.fn(),
        resume: jest.fn(),
        clean: jest.fn(),
        getBackend: jest.fn(() => ({ client: Promise.resolve(new EventEmitter()) })),
      }) as unknown as jest.Mocked<Queue>

    defaultQueue = createMockQueue()
    emailQueue = createMockQueue()
    notificationsQueue = createMockQueue()
    aiRunsQueue = createMockQueue()
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>
    metrics = {
      incQueueEvent: jest.fn(),
      incRedisClientEvent: jest.fn(),
    }

    managedAdd = jest.fn().mockResolvedValue({ jobId: 'managed-id', incarnation: 'managed-inc' })
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        { provide: MANAGED_PRODUCERS, useValue: new Map([[QueueName.EMAIL, { add: managedAdd }]]) },
        {
          provide: QUEUE_REGISTRY,
          useValue: new Map([
            [QueueName.DEFAULT, defaultQueue],
            [QueueName.EMAIL, emailQueue],
            [QueueName.NOTIFICATIONS, notificationsQueue],
            [QueueName.AI_RUNS, aiRunsQueue],
          ]),
        },
        {
          provide: PinoLogger,
          useValue: mockLogger,
        },
        {
          provide: MetricsService,
          useValue: metrics,
        },
      ],
    }).compile()

    service = module.get<QueueService>(QueueService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  describe('onModuleInit (EQS-06 producer observability)', () => {
    it('logs queue.redis_error at error level when the Queue emits an error', () => {
      service.onModuleInit()

      // QueueBase re-emits underlying connection errors on the Queue itself.
      ;(emailQueue as unknown as EventEmitter).emit('error', new Error('ECONNREFUSED'))

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'queue.redis_error', queueName: QueueName.EMAIL }),
        expect.any(String)
      )
      expect(metrics.incRedisClientEvent).toHaveBeenCalledWith('queue_producer', 'error')
      expect(metrics.incQueueEvent).toHaveBeenCalledWith(QueueName.EMAIL, 'redis_error')
    })

    it('returns synchronously without awaiting the (possibly-never-ready) client', () => {
      // A client promise that never settles must not hang onModuleInit.
      emailQueue.getBackend.mockReturnValue({
        client: new Promise(() => {
          /* never settles — simulates Redis down with unbounded retryStrategy */
        }),
      } as never)

      expect(() => service.onModuleInit()).not.toThrow()
      // Synchronous error wiring still works on the never-ready queue.
      ;(emailQueue as unknown as EventEmitter).emit('error', new Error('down'))
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'queue.redis_error' }),
        expect.any(String)
      )
    })

    it('attaches a reconnecting listener once the client is ready (fire-and-forget)', async () => {
      const client = new EventEmitter()
      const clientPromise = Promise.resolve(client)
      emailQueue.getBackend.mockReturnValue({ client: clientPromise } as never)

      service.onModuleInit()
      // Flush the queue.getBackend().client.then microtask so the listener is attached.
      await clientPromise

      client.emit('reconnecting')

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'queue.redis_reconnecting', queueName: QueueName.EMAIL }),
        expect.any(String)
      )
      expect(metrics.incRedisClientEvent).toHaveBeenCalledWith('queue_producer', 'reconnecting')
      expect(metrics.incQueueEvent).toHaveBeenCalledWith(QueueName.EMAIL, 'redis_reconnecting')
    })

    it('swallows a rejected client without breaking boot', async () => {
      const rejected = Promise.reject(new Error('no connection'))
      emailQueue.getBackend.mockReturnValue({ client: rejected } as never)

      expect(() => service.onModuleInit()).not.toThrow()
      await rejected.catch(() => undefined)
      await Promise.resolve()

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ queueName: QueueName.EMAIL }),
        expect.stringContaining('Failed to attach')
      )
    })
  })

  describe('managed producer delegation', () => {
    it('uses the generated producer without raw Queue.add', async () => {
      const payload = { reference: 'welcome' }
      const result = await service.add(QueueName.EMAIL, 'send-email', payload, { attempts: 2 })
      expect(result).toEqual({ jobId: 'managed-id', incarnation: 'managed-inc' })
      expect(managedAdd).toHaveBeenCalledWith('send-email', payload, { attempts: 2 })
      expect(emailQueue.add).not.toHaveBeenCalled()
    })
    it('refuses a registered external queue without falling back to stock add', async () => {
      await expect(service.add(QueueName.DEFAULT, 'raw-job', {})).rejects.toThrow(
        'ACTION_UNAVAILABLE'
      )
      expect(defaultQueue.add).not.toHaveBeenCalled()
    })
    it('refuses an unknown queue before producer dispatch', async () => {
      await expect(service.add('unknown-queue', 'job', {})).rejects.toThrow(NotFoundException)
      expect(managedAdd).not.toHaveBeenCalled()
    })
  })

  describe('getQueue', () => {
    it('should return the correct queue', () => {
      expect(service.getQueue(QueueName.DEFAULT)).toBe(defaultQueue)
      expect(service.getQueue(QueueName.EMAIL)).toBe(emailQueue)
    })

    it('should return undefined for unknown queue', () => {
      expect(service.getQueue('unknown')).toBeUndefined()
    })
  })
})
