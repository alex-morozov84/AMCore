import { registerAs } from '@nestjs/config'
import type { DefaultJobOptions } from 'bullmq'
import { URL } from 'url'

export interface QueueConfig {
  redis: {
    host: string
    port: number
    password?: string
    db?: number
  }
  defaultJobOptions: DefaultJobOptions
  prefix: string
}

export default registerAs('queue', (): QueueConfig => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
  const url = new URL(redisUrl)

  return {
    redis: {
      host: url.hostname,
      port: parseInt(url.port, 10) || 6379,
      password: url.password || undefined,
      db: url.pathname ? parseInt(url.pathname.slice(1), 10) : 0,
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: {
        age: 3600, // 1 hour
        count: 100,
      },
      removeOnFail: {
        age: 86400, // 24 hours
        count: 1000,
      },
    },
    prefix: 'amcore',
  }
})
