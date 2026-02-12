import { getQueueToken } from '@nestjs/bullmq'
import { NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import type { Job, Queue } from 'bullmq'

import { JobName, QueueName } from './constants/queues.constant'
import { QueueService } from './queue.service'

describe('QueueService', () => {
  let service: QueueService
  let defaultQueue: jest.Mocked<Queue>
  let emailQueue: jest.Mocked<Queue>

  beforeEach(async () => {
    // Create mock queues
    const createMockQueue = (): jest.Mocked<Queue> =>
      ({
        add: jest.fn(),
        getJob: jest.fn(),
        getActive: jest.fn(),
        getFailed: jest.fn(),
        pause: jest.fn(),
        resume: jest.fn(),
        clean: jest.fn(),
      }) as unknown as jest.Mocked<Queue>

    defaultQueue = createMockQueue()
    emailQueue = createMockQueue()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: getQueueToken(QueueName.DEFAULT),
          useValue: defaultQueue,
        },
        {
          provide: getQueueToken(QueueName.EMAIL),
          useValue: emailQueue,
        },
      ],
    }).compile()

    service = module.get<QueueService>(QueueService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  describe('add', () => {
    it('should add a job to the queue', async () => {
      const jobData = { name: 'Test User' }
      const mockJob = { id: 'job-123', data: jobData } as Job

      defaultQueue.add.mockResolvedValue(mockJob as never)

      const result = await service.add(QueueName.DEFAULT, JobName.HELLO_WORLD, jobData)

      expect(result).toEqual(mockJob)
      expect(defaultQueue.add).toHaveBeenCalledWith(
        JobName.HELLO_WORLD,
        jobData,
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        })
      )
    })

    it('should throw NotFoundException for unknown queue', async () => {
      await expect(service.add('unknown-queue', JobName.HELLO_WORLD, {})).rejects.toThrow(
        NotFoundException
      )
    })

    it('should merge custom options with defaults', async () => {
      const jobData = { name: 'Test' }
      const customOptions = { priority: 10, attempts: 5 }
      const mockJob = { id: 'job-456' } as Job

      defaultQueue.add.mockResolvedValue(mockJob as never)

      await service.add(QueueName.DEFAULT, JobName.HELLO_WORLD, jobData, customOptions)

      expect(defaultQueue.add).toHaveBeenCalledWith(
        JobName.HELLO_WORLD,
        jobData,
        expect.objectContaining({
          priority: 10,
          attempts: 5, // Custom value
        })
      )
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

  describe('removeJob', () => {
    it('should remove a job from the queue', async () => {
      const mockJob = { id: 'job-123', remove: jest.fn() } as unknown as Job

      defaultQueue.getJob.mockResolvedValue(mockJob as never)

      await service.removeJob(QueueName.DEFAULT, 'job-123')

      expect(defaultQueue.getJob).toHaveBeenCalledWith('job-123')
      expect(mockJob.remove).toHaveBeenCalled()
    })

    it('should throw NotFoundException if job not found', async () => {
      defaultQueue.getJob.mockResolvedValue(undefined as never)

      await expect(service.removeJob(QueueName.DEFAULT, 'job-999')).rejects.toThrow(
        NotFoundException
      )
    })
  })

  describe('getJob', () => {
    it('should get a job by ID', async () => {
      const mockJob = { id: 'job-123', data: { test: true } } as Job

      defaultQueue.getJob.mockResolvedValue(mockJob as never)

      const result = await service.getJob(QueueName.DEFAULT, 'job-123')

      expect(result).toEqual(mockJob)
      expect(defaultQueue.getJob).toHaveBeenCalledWith('job-123')
    })

    it('should return undefined if job not found', async () => {
      defaultQueue.getJob.mockResolvedValue(undefined as never)

      const result = await service.getJob(QueueName.DEFAULT, 'job-999')

      expect(result).toBeUndefined()
    })

    it('should throw NotFoundException for unknown queue', async () => {
      await expect(service.getJob('unknown', 'job-123')).rejects.toThrow(NotFoundException)
    })
  })

  describe('getActiveJobs', () => {
    it('should return active jobs', async () => {
      const mockJobs = [{ id: 'job-1' }, { id: 'job-2' }] as Job[]

      defaultQueue.getActive.mockResolvedValue(mockJobs as never)

      const result = await service.getActiveJobs(QueueName.DEFAULT)

      expect(result).toEqual(mockJobs)
      expect(defaultQueue.getActive).toHaveBeenCalled()
    })

    it('should throw NotFoundException for unknown queue', async () => {
      await expect(service.getActiveJobs('unknown')).rejects.toThrow(NotFoundException)
    })
  })

  describe('getFailedJobs', () => {
    it('should return failed jobs', async () => {
      const mockJobs = [{ id: 'job-1', failedReason: 'Error' }] as Job[]

      defaultQueue.getFailed.mockResolvedValue(mockJobs as never)

      const result = await service.getFailedJobs(QueueName.DEFAULT)

      expect(result).toEqual(mockJobs)
      expect(defaultQueue.getFailed).toHaveBeenCalled()
    })
  })

  describe('retryJob', () => {
    it('should retry a failed job', async () => {
      const mockJob = { id: 'job-123', retry: jest.fn() } as unknown as Job

      defaultQueue.getJob.mockResolvedValue(mockJob as never)

      await service.retryJob(QueueName.DEFAULT, 'job-123')

      expect(mockJob.retry).toHaveBeenCalled()
    })

    it('should throw NotFoundException if job not found', async () => {
      defaultQueue.getJob.mockResolvedValue(undefined as never)

      await expect(service.retryJob(QueueName.DEFAULT, 'job-999')).rejects.toThrow(
        NotFoundException
      )
    })
  })

  describe('pauseQueue', () => {
    it('should pause a queue', async () => {
      await service.pauseQueue(QueueName.DEFAULT)

      expect(defaultQueue.pause).toHaveBeenCalled()
    })

    it('should throw NotFoundException for unknown queue', async () => {
      await expect(service.pauseQueue('unknown')).rejects.toThrow(NotFoundException)
    })
  })

  describe('resumeQueue', () => {
    it('should resume a queue', async () => {
      await service.resumeQueue(QueueName.DEFAULT)

      expect(defaultQueue.resume).toHaveBeenCalled()
    })

    it('should throw NotFoundException for unknown queue', async () => {
      await expect(service.resumeQueue('unknown')).rejects.toThrow(NotFoundException)
    })
  })

  describe('cleanQueue', () => {
    it('should clean completed jobs', async () => {
      const cleanedJobs = ['job-1', 'job-2']

      defaultQueue.clean.mockResolvedValue(cleanedJobs as never)

      const result = await service.cleanQueue(QueueName.DEFAULT, 3600, 'completed')

      expect(result).toEqual(cleanedJobs)
      expect(defaultQueue.clean).toHaveBeenCalledWith(3600, 1000, 'completed')
    })

    it('should clean failed jobs', async () => {
      const cleanedJobs = ['job-3']

      defaultQueue.clean.mockResolvedValue(cleanedJobs as never)

      const result = await service.cleanQueue(QueueName.DEFAULT, 86400, 'failed')

      expect(result).toEqual(cleanedJobs)
      expect(defaultQueue.clean).toHaveBeenCalledWith(86400, 1000, 'failed')
    })

    it('should throw NotFoundException for unknown queue', async () => {
      await expect(service.cleanQueue('unknown', 3600, 'completed')).rejects.toThrow(
        NotFoundException
      )
    })
  })
})
