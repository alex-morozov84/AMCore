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

> **Note:** the starter ships **one** real processor — `EmailProcessor` on the
> `email` queue. `QueueName.DEFAULT` is a registered generic queue with **no
> default worker**; the snippets below are illustrative. Add your own `JobName`
> and a processor (see "Creating a Job Processor") before enqueuing to it.

```typescript
import { Injectable } from '@nestjs/common'
import { QueueService, QueueName } from '@/infrastructure/queue'

@Injectable()
export class MyService {
  constructor(private readonly queueService: QueueService) {}

  async doSomethingAsync() {
    // Add a job to the queue (define your own job-name string/enum)
    const job = await this.queueService.add(QueueName.DEFAULT, 'my-job', {
      userId: 'user-123',
      action: 'sync',
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

> Illustrative example — `MyJobProcessor` is **not** part of the shipped starter
> (the demo HelloWorld processor was intentionally removed; only `EmailProcessor`
> ships). Use this as a template for your own processors.

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

### 3. Register Processor in a worker-only module

Do **not** add the processor to `QueueModule` — `QueueModule` is shared
infrastructure (`coreImports`, every role), and NestJS starts a `Worker` for any
`@Processor` in the graph, so a processor placed there would also run inside the
`web` process. Provide it in a **worker-only** module that is imported only via
`workerImports` (the `EmailWorkerModule` pattern):

```typescript
// my-feature-worker.module.ts — imported ONLY in workerImports (app-imports.ts)
@Module({
  providers: [MyJobProcessor],
})
export class MyFeatureWorkerModule {}
```

Keep the **producer** (the service that enqueues via `QueueService`) in a module the
`web` role can import; keep the **consumer** (`MyJobProcessor`) in the worker-only
module above. See
[`docs/backend/architecture-and-conventions.md`](../../../../../docs/backend/architecture-and-conventions.md#5-register-in-the-correct-process-role)
and `src/app-imports.ts`.

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

Access the Bull Board UI under the **`/admin/queues`** route. It is mounted as
Express middleware by `@bull-board/nestjs`; the exact reachable URL follows the
app's global prefix (the adapter base path is `getGlobalPrefix() + route`), so a
production app started with `setGlobalPrefix('api/v1')` serves it under
`/api/v1/admin/queues`, while the e2e harness (no global prefix) serves it at
`/admin/queues`. Confirm the path for your bootstrap if you change the prefix.

Features:

- View all queues and their stats
- Monitor active, waiting, completed, and failed jobs
- Retry failed jobs
- Clean up old jobs
- View job details and logs

**Access control (EQS-01):**

- **Mount gate** — not mounted in production unless `ENABLE_BULL_BOARD=true`;
  the router and placeholder controller are absent from the module graph by
  default (zero attack surface). Mounted by default in non-production, but
  still protected.
- **Auth** — enforcement is `createBullBoardAuthMiddleware` (runs before the
  router), **not** the `DashboardController` `@SystemRoles` guard (that
  controller is a Swagger-only placeholder and never sees the UI's requests).
  The middleware rejects API-key / `x-api-key` machine credentials and requires
  a valid `refresh_token` cookie belonging to a `SUPER_ADMIN` user
  (read-only verification — no session rotation). Browser UI only; there is no
  bearer-token path. See ADR-034 amendment 2026-05-29.
- **Auth coverage is path-independent.** The auth middleware and the Bull Board
  router are bound in the _same_ registration call
  (`consumer.apply(middleware, router).forRoutes(route)`), so they always mount
  at the identical path — whatever the global prefix resolves to, the
  middleware gates the router and all of its subroutes (incl. the data API that
  exposes job payloads). The e2e proves this for `/admin/queues` and
  `/admin/queues/api/queues`.

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

Single source of truth: `DEFAULT_JOB_OPTIONS` in
`interfaces/job-options.interface.ts`. It is applied both as the module-level
`defaultJobOptions` (`queue.module.ts`) and merged per-`add` by `QueueService`.
Per-domain overrides derive from it rather than re-declaring literals — e.g. the
email queue uses `EMAIL_JOB_OPTIONS = { ...DEFAULT_JOB_OPTIONS, backoff: {
type: 'exponential', delay: 2000 } }` (gentler first retry).

```typescript
// DEFAULT_JOB_OPTIONS
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
# Plain (local/dev):
REDIS_URL=redis://localhost:6379
# TLS (managed Redis — Upstash/ElastiCache/Redis Cloud) + Redis 6 ACL:
# REDIS_URL=rediss://username:password@host:6380/0
```

The BullMQ connection is built from `REDIS_URL` by `buildBullConnection`
(`redis-connection.config.ts`) — the single, tested source of the connection
options (EQS-06):

- **TLS** is enabled **iff** the scheme is `rediss://` (`tls: { servername }`).
  Plain `redis://` is left untouched.
- **username / password / db** are all parsed (ACL-aware; credentials are
  percent-decoded).
- **`retryStrategy`** mirrors `RedisConnectionService` (50 ms/attempt, capped at
  2 s) so both Redis clients reconnect on one curve.
- **`maxRetriesPerRequest` is deliberately NOT set** on this producer
  connection — `null` would make `queue.add()` hang forever during an outage,
  and BullMQ already enforces `null` on the worker's blocking connection itself.

```typescript
// Effective connection (rediss:// example)
{
  host, port, db,
  username, password,                       // when present in the URL
  tls: { servername: host },                // only for rediss://
  retryStrategy: (n) => Math.min(n*50, 2000),
}
// prefix: 'amcore'; defaultJobOptions: { /* ... */ }
```

### Outage behavior & observability (EQS-06)

- **Enqueuing a transactional email is best-effort** relative to the primary
  request — a Redis/BullMQ outage must **never** turn a user-facing mutation
  (whose real work already committed) into a 500. `QueueService.add` keeps
  throwing (it is the low-level primitive); the **caller** decides. The one
  queued email call site is fire-and-forget (`void send(...).catch(warn)`):
  `register`/welcome. Secret-bearing emails (reset/verification/invite) are sent
  directly via `EmailService.sendNow` and never touch the queue at all (EQS-02),
  so an outage cannot affect them. The password-changed alert now flows through
  the durable notifications subsystem (ADR-052) — its worker-only email adapter
  calls `EmailService.send()` directly and the recovery poller, not the EMAIL
  queue, is its outage-recovery path.
- **Observability** is logged at error level on both connections:
  - producer — `QueueService.onModuleInit` attaches an `error` listener
    **synchronously on the BullMQ `Queue`** (QueueBase re-emits connection
    errors) → `event: 'queue.redis_error'`. The `reconnecting` listener (only on
    the raw ioredis client) is attached **fire-and-forget** via
    `void queue.client.then(...)` → `queue.redis_reconnecting` (warn). It is
    **never awaited**: `queue.client` is BullMQ's ready-gated promise and may
    never settle while Redis is down, so awaiting it would hang bootstrap.
  - worker — `EmailProcessor` `@OnWorkerEvent('error')` →
    `event: 'queue.worker_error'` (the worker holds a separate blocking
    connection; without this a Redis outage can stall processing with no
    `email.job.dead_letter` and no producer-side failure).

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
