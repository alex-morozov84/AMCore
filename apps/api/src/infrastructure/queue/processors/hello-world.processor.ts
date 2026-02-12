import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'

import { JobName, QueueName } from '../constants/queues.constant'

interface HelloWorldJobData {
  name: string
  message?: string
}

@Processor(QueueName.DEFAULT)
export class HelloWorldProcessor extends WorkerHost {
  private readonly logger = new Logger(HelloWorldProcessor.name)

  async process(job: Job<HelloWorldJobData>): Promise<string> {
    this.logger.log(`Processing job ${job.name} with ID ${job.id}`)

    // Only process hello-world jobs
    if (job.name !== JobName.HELLO_WORLD) {
      return `Skipped job ${job.name}`
    }

    const { name, message } = job.data

    // Simulate async work
    await this.simulateWork(1000)

    const result = `Hello, ${name}! ${message || 'Welcome to BullMQ.'}`

    this.logger.log(`Job ${job.id} completed`, { result })

    return result
  }

  private async simulateWork(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
