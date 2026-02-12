# Queue Infrastructure (BullMQ)

Production-ready job queue system built on BullMQ for handling async operations.

## Features

- ✅ **Multiple Queues** — Separate queues for different job types (email, default)
- ✅ **Retry Logic** — Exponential backoff with configurable attempts
- ✅ **Priority Jobs** — Priority levels 0-10
- ✅ **Delayed Jobs** — Schedule jobs for future execution
- ✅ **Job Monitoring** — Bull Board dashboard at `/admin/queues`
- ✅ **Type Safety** — Full TypeScript support
- ✅ **Error Handling** — Structured logging and error tracking

## Quick Start

### 1. Inject QueueService

```typescript
import { Injectable } from '@nestjs/common'
import { QueueService, QueueName, JobName } from '@/infrastructure/queue'

@Injectable()
export class MyService {
  constructor(private readonly queueService: QueueService) {}

  async doSomethingAsync() {
    // Add a job to the queue
    const job = await this.queueService.add(QueueName.DEFAULT, JobName.HELLO_WORLD, {
      name: 'Alex',
      message: 'Test message',
    })

    console.log('Job added:', job.id)
  }
}
```

### 2. Add Job with Options

```typescript
// High priority job with custom retry
await this.queueService.add(
  QueueName.EMAIL,
  JobName.SEND_EMAIL,
  { to: 'user@example.com', template: 'welcome' },
  {
    priority: 10, // High priority
    attempts: 5, // Try 5 times
    delay: 1000, // Delay 1 second
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  }
)
```

### 3. Schedule Delayed Job

```typescript
// Send email in 1 hour
await this.queueService.add(QueueName.EMAIL, JobName.SEND_EMAIL, emailData, {
  delay: 60 * 60 * 1000, // 1 hour in ms
})
```

## Creating a Job Processor

### 1. Define Job Data Interface

```typescript
// processors/my-job.processor.ts
interface MyJobData {
  userId: string
  action: string
}
```

### 2. Create Processor Class

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { QueueName } from '../constants/queues.constant'

@Processor(QueueName.DEFAULT)
export class MyJobProcessor extends WorkerHost {
  private readonly logger = new Logger(MyJobProcessor.name)

  async process(job: Job<MyJobData>): Promise<string> {
    this.logger.log(`Processing job ${job.name} with ID ${job.id}`)

    const { userId, action } = job.data

    // Do your async work here
    await this.performAction(userId, action)

    // Update job progress (optional)
    await job.updateProgress(50)

    // More work...
    await job.updateProgress(100)

    return `Job completed for user ${userId}`
  }

  private async performAction(userId: string, action: string) {
    // Your business logic
  }
}
```

### 3. Register Processor

Add to `QueueModule` providers:

```typescript
@Module({
  // ...
  providers: [QueueService, HelloWorldProcessor, MyJobProcessor],
})
export class QueueModule {}
```

## Adding New Queues

### 1. Add Queue Name

```typescript
// constants/queues.constant.ts
export enum QueueName {
  EMAIL = 'email',
  DEFAULT = 'default',
  NOTIFICATIONS = 'notifications', // NEW
}
```

### 2. Register in Module

```typescript
// queue.module.ts
BullModule.registerQueue(
  { name: QueueName.DEFAULT },
  { name: QueueName.EMAIL },
  { name: QueueName.NOTIFICATIONS }, // NEW
),

// Bull Board
BullBoardModule.forFeature({
  name: QueueName.NOTIFICATIONS,
  adapter: BullMQAdapter,
}),
```

### 3. Update QueueService Constructor

```typescript
// queue.service.ts
constructor(
  @InjectQueue(QueueName.DEFAULT) private readonly defaultQueue: Queue,
  @InjectQueue(QueueName.EMAIL) private readonly emailQueue: Queue,
  @InjectQueue(QueueName.NOTIFICATIONS) private readonly notificationsQueue: Queue,
) {
  this.queues.set(QueueName.DEFAULT, defaultQueue)
  this.queues.set(QueueName.EMAIL, emailQueue)
  this.queues.set(QueueName.NOTIFICATIONS, notificationsQueue)
}
```

## Queue Management

### Get Job Status

```typescript
const job = await this.queueService.getJob(QueueName.DEFAULT, 'job-123')
console.log(job?.state) // 'active', 'completed', 'failed', etc.
```

### Retry Failed Job

```typescript
await this.queueService.retryJob(QueueName.DEFAULT, 'job-123')
```

### Get Failed Jobs

```typescript
const failedJobs = await this.queueService.getFailedJobs(QueueName.DEFAULT)
for (const job of failedJobs) {
  console.log(`Job ${job.id} failed:`, job.failedReason)
}
```

### Pause/Resume Queue

```typescript
// Pause queue (stop processing new jobs)
await this.queueService.pauseQueue(QueueName.DEFAULT)

// Resume queue
await this.queueService.resumeQueue(QueueName.DEFAULT)
```

### Clean Old Jobs

```typescript
// Clean completed jobs older than 1 hour (3600s)
await this.queueService.cleanQueue(QueueName.DEFAULT, 3600, 'completed')

// Clean failed jobs older than 24 hours
await this.queueService.cleanQueue(QueueName.DEFAULT, 86400, 'failed')
```

## Bull Board Dashboard

Access the Bull Board UI at: **http://localhost:3001/admin/queues**

Features:

- View all queues and their stats
- Monitor active, waiting, completed, and failed jobs
- Retry failed jobs
- Clean up old jobs
- View job details and logs

**Note:** Dashboard is protected by JWT authentication (see `DashboardController`).

## Job Options Reference

```typescript
interface JobOptions {
  priority?: number // 0-10 (higher is better)
  delay?: number // Delay in ms
  attempts?: number // Retry attempts (default: 3)
  backoff?: {
    type: 'exponential' | 'fixed'
    delay?: number // Backoff delay in ms
  }
  removeOnComplete?: boolean | number | KeepJobs
  removeOnFail?: boolean | number | KeepJobs
}
```

### Default Options

```typescript
{
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000, // 1s, 2s, 4s...
  },
  removeOnComplete: {
    age: 3600, // 1 hour
    count: 100, // keep last 100
  },
  removeOnFail: {
    age: 86400, // 24 hours
    count: 1000, // keep last 1000
  },
}
```

## Testing

### Unit Tests

```typescript
import { Test } from '@nestjs/testing'
import { getQueueToken } from '@nestjs/bullmq'
import { QueueService } from './queue.service'
import { QueueName } from './constants/queues.constant'

describe('MyService', () => {
  let queueService: QueueService
  let mockQueue: jest.Mocked<Queue>

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn(),
    } as any

    const module = await Test.createTestingModule({
      providers: [
        MyService,
        QueueService,
        {
          provide: getQueueToken(QueueName.DEFAULT),
          useValue: mockQueue,
        },
      ],
    }).compile()

    queueService = module.get(QueueService)
  })

  it('should add job to queue', async () => {
    await queueService.add(QueueName.DEFAULT, 'test-job', {})
    expect(mockQueue.add).toHaveBeenCalled()
  })
})
```

## Best Practices

1. **Use Separate Queues** — Group related jobs in the same queue
2. **Set Appropriate Priorities** — Use 5 as default, 10 for critical jobs
3. **Configure Retries** — Always set retry limits to prevent infinite loops
4. **Clean Old Jobs** — Regularly clean up completed/failed jobs to save memory
5. **Log Everything** — Use structured logging for debugging
6. **Monitor Dashboard** — Check Bull Board regularly for failed jobs
7. **Handle Errors Gracefully** — Always catch and log errors in processors
8. **Use Job Progress** — Update progress for long-running jobs

## Configuration

Environment variables:

```env
REDIS_URL=redis://localhost:6379
```

Queue config (`queue.config.ts`):

```typescript
{
  redis: {
    host: 'localhost',
    port: 6379,
    password: undefined,
    db: 0,
  },
  prefix: 'amcore', // All queues will be prefixed with 'amcore:'
  defaultJobOptions: { /* ... */ }
}
```

## Architecture

```
┌─────────────────────────────────────────────┐
│         Business Module (Auth)              │
│                                             │
│  await queueService.add(                    │
│    QueueName.EMAIL,                         │
│    'send-welcome-email',                    │
│    { email: user.email }                    │
│  )                                          │
└─────────────┬───────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│         QueueService                        │
│  • Add jobs                                 │
│  • Monitor jobs                             │
│  • Retry failed jobs                        │
└─────────────┬───────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│         Redis (BullMQ)                      │
│  • Store jobs                               │
│  • Job scheduling                           │
│  • Priority queue                           │
└─────────────┬───────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│         EmailProcessor (Worker)             │
│  • Process jobs                             │
│  • Handle retries                           │
│  • Update job status                        │
└─────────────────────────────────────────────┘
```

## Troubleshooting

### Jobs Not Processing

1. Check Redis connection: `docker compose ps`
2. Check worker logs for errors
3. Verify processor is registered in module
4. Check queue is not paused

### High Memory Usage

1. Clean old jobs regularly
2. Reduce `removeOnComplete.count` and `removeOnFail.count`
3. Decrease retention times (`age`)

### Failed Jobs

1. Check Bull Board dashboard
2. Review job logs in processor
3. Retry with `queueService.retryJob()`
4. Adjust retry attempts and backoff strategy

## Related Files

- `queue.module.ts` — Module registration
- `queue.service.ts` — Main service
- `queue.config.ts` — Configuration
- `constants/queues.constant.ts` — Queue and job names
- `processors/` — Job processors
- `interfaces/` — TypeScript types
