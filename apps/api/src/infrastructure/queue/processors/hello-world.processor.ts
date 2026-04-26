import { Processor, WorkerHost } from '@nestjs/bullmq'
import type { Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'

import { JobName, QueueName } from '../constants/queues.constant'

interface HelloWorldJobData {
  name: string
  message?: string
}

@Processor(QueueName.DEFAULT)
export class HelloWorldProcessor extends WorkerHost {
  constructor(private readonly logger: PinoLogger) {
    super()
    this.logger.setContext(HelloWorldProcessor.name)
  }

  async process(job: Job<HelloWorldJobData>): Promise<string> {
    this.logger.info(
      { jobName: job.name, jobId: job.id },
      `Processing job ${job.name} with ID ${job.id}`
    )

    // Only process hello-world jobs
    if (job.name !== JobName.HELLO_WORLD) {
      return `Skipped job ${job.name}`
    }

    const { name, message } = job.data

    // Simulate async work
    await this.simulateWork(1000)

    const result = `Hello, ${name}! ${message || 'Welcome to BullMQ.'}`

    this.logger.info({ jobId: job.id, result }, `Job ${job.id} completed`)

    return result
  }

  private async simulateWork(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
