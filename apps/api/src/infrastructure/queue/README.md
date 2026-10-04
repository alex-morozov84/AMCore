# Queue Infrastructure (BullMQ)

Production-ready job queue system built on BullMQ for handling async operations.

## Features

- ✅ **Multiple Queues** — One code-owned inventory of queues (`email`, `default`, `notifications`, `ai-runs`) drives registration, `QueueService`, metrics and, with the optional Operations Console, its Background work screen
- ✅ **Retry Logic** — Exponential backoff with configurable attempts
- ✅ **Priority Jobs** — BullMQ priorities: a lower positive number runs first, and unprioritized jobs run before prioritized ones
- ✅ **Delayed Jobs** — Schedule jobs for future execution
- ✅ **Job Monitoring** — Bull Board dashboard at `/admin/queues`, and, with the optional Operations Console, a read-only Background work screen
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
// Custom retry; a prioritized job runs after every unprioritized job
await this.queueService.add(
  QueueName.EMAIL,
  JobName.SEND_EMAIL,
  { to: 'user@example.com', template: 'welcome' },
  {
    priority: 2, // Optional. Lower numbers run first; leave it out for the normal lane
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

## The queue inventory

`constants/queue-inventory.constant.ts` is the single source of truth for which
queues exist. Each `QueueName` has a descriptor:

| Field     | Meaning                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------- |
| `kind`    | `work` (jobs carry the work), `wake` (one-attempt wake signals; state lives in Postgres), or `extension` |
| `enabled` | Code-owned intent. `false` removes the registration, the Bull Board adapter and every observation read   |

The descriptor map is typed `satisfies Record<QueueName, …>`, so a new enum value
without a descriptor does not compile. `QueueModule` registers the enabled queues,
`QueueService` receives them as one registry, the depth metrics iterate them, and
the optional Operations Console's Background work screen reports every descriptor
(`disabled` rows included).

### Adding a queue

1. Add the value to `QueueName` in `constants/queues.constant.ts`.
2. Add its descriptor to `DESCRIPTORS` in `constants/queue-inventory.constant.ts`.
3. Add a processor in a worker-only module (see above) if jobs should be consumed.
4. Nothing to add for the board: every enabled queue gets a read-only Bull Board adapter and
   shows in Background work. Its job data stays hidden until you add a projection to
   `BOARD_DATA_PROJECTIONS`.
5. Optional: add Console copy for it in `console.backgroundWork.queues` in
   `apps/web/messages/*.json`. Without it the screen shows the technical name and
   generic copy for its `kind`.

Do not register a queue yourself with `BullModule.registerQueue`, `@InjectQueue` or
`new Queue(...)`. A queue created outside the inventory is invisible to the Console,
the metrics and `QueueService`, and nothing would say so. The guard test
`queue-registration-coverage.spec.ts` fails with the file and line when production
code does this; `queue.module.ts` is the only allowed place. It reads the source
through the TypeScript AST, so import aliases (`Queue as ReportQueue`), namespace
imports and multi-line calls are caught. It cannot see queues built dynamically or
through a re-export of `Queue` from your own module: it guards against accidents,
not against deliberate workarounds.

### Disabling a queue

`enabled: false` is **not** a feature switch. It does not remove producers or
processors, so a producer that still calls `QueueService.add` for a disabled queue
fails at call time with `NotFoundException('Queue', name)`. Only `default` has no
stock producer or processor and can be disabled by the flag alone. Disabling
`email`, `notifications` or `ai-runs` also means removing the feature module that
owns its producer and its worker module in your fork.

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

The API can serve the [Bull Board](https://github.com/felixmosh/bull-board) UI as a **view-only**
queue board under **`/admin/queues`** (with the global prefix: `/api/v1/admin/queues`). It lists
queues, their jobs and one job's details. It cannot change anything, and no setting can make it:
every adapter is built read-only, the HTTP boundary answers any method other than `GET`/`HEAD`
with `405`, and every response is rebuilt from a closed list of fields. The operator-facing guide
is in the Operations Console documentation (`docs/operations-console/queue-board.md`) when the
Console is present; this section is the contract for developers.

### Mounting

- **Production:** not mounted unless `ENABLE_BULL_BOARD=true` is a real **process** environment
  variable when the API starts. A value that only a `.env` file supplies does nothing, because the
  decision is taken before `.env` is loaded.
- **Other environments:** always mounted (and still authenticated).
- **`worker` role:** never. Roles `web` and `all` serve it.
- The decision is one frozen snapshot (`BULL_BOARD_MOUNT`, `dashboard/bull-board-mount-state.ts`)
  read by the module graph, by `GET /admin/background-work/queues` (`board.state`) and by the
  OpenAPI document, so what is reported is always what is mounted.
- `BULL_BOARD_READ_ONLY` is **retired and ignored**, whatever its value. A start with it set (roles
  `web`/`all`) logs `bull_board.legacy_read_only_flag_ignored` once. Remove it.

### Access

Authentication is an Express middleware in front of the router, not a Nest guard (the router never
passes through Nest's guards). Two ways in, never mixed: a request with any `Authorization` header
is judged only as a bearer; without one, the browser cookie is judged.

- **Bearer (the Console BFF):** a live `SUPER_ADMIN` access token. The role in the signed claim must
  be `SUPER_ADMIN` **and** the current role in the database must still be, on every request
  (`PrivilegedAdmissionService`, the same rule as other privileged routes). `401` for an invalid,
  expired or unknown-user token, `403` for a non-administrator or demoted user, `503` when the
  database cannot be asked. API keys (`amcore_` bearer or `x-api-key`) are always `401`.
- **Cookie (direct access, no Console):** a `refresh_token` cookie of a `SUPER_ADMIN` user, checked
  read-only against the session table (no rotation). Browser only; it is not a bearer.

A bearer request may carry `X-AMCore-Board-Context`, a strict base64url JSON with the public base
path, the locale and the way back to the Console. It is presentation only and is ignored on a
cookie request; an invalid one is `400`.

### What it allows and shows

Only `GET`/`HEAD` of the page, its static files, `GET /api/queues` (bounded query: `activeQueue`,
`status`, `page`, `jobsPerPage` up to 50) and one job. Job logs and a job's flow (parents and
children, which can span other queues) get a fixed, schema-valid reply without anything being read.
Schedulers, default job options, rate limits, workers, Redis details and metrics are closed (the
UI is configured not to ask for them). Per job it returns id, name, times, attempts, delay, whether it failed and a short list of
retry/retention options; payloads, return values, failure text and stack traces are replaced.
`data` of a queue is shown only through a projection registered in `BOARD_DATA_PROJECTIONS`, a `Map`
that answers only for the names listed (`email`, `notifications` and `ai-runs` ship with one: template,
locale and user id; notification id; run id); the `default` queue and any other queue, whatever its name,
are hidden.

The one write the board's reads can cause is BullMQ's own: counting a queue may remove a pre-v5 legacy
marker from the end of a waiting list. It is measured by the disclosure e2e suite. No queue or job state
is changed through the board.

An error never carries a message or a stack: after the Board's own response validation every status
`>= 400` is reduced to `{ "error": { "key": "ERRORS.…" } }`. The board's HTML page is rendered with
a callback, so a failing render is answered with the same fixed `500`. The router ends with a terminal `404` and an error handler, and the guard refuses an undecodable path with a `400`, so a missing static file or a malformed address gets the same fixed body instead of the application's general not-found response (which names the requested URL).

To show the payload of a queue you add, write a projection that rebuilds a small object from
validated fields (identifiers and categories, never addresses, names, tokens or free text) and add
tests next to `bull-board-data-projections.spec.ts`. An upgrade of `@bull-board/*` that adds a
route or a field fails `bull-board-upgrade-guard.spec.ts` until it is reviewed.

### Response headers

Every answer of the mount carries the board's headers, including a refusal of the admission
middleware, an error and the answer of a request that the global parser or CORS would have answered
first: a guard registered before them (`configureBullBoardEdge`) answers every method but `GET`/`HEAD`
(a CORS preflight included) with `405` and `Allow: GET, HEAD`, ignores the body of a `GET`, and
re-applies the board's headers when the response head is written, replacing Helmet's and removing any
CORS headers. The answers are `Cache-Control: private, no-store` (`no-cache` for static files),
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
`Cross-Origin-Resource-Policy: same-origin` and the board's own `Content-Security-Policy`
(`BULL_BOARD_CONTENT_SECURITY_POLICY` in `@amcore/shared`): its own scripts only, no framing, no
reporting endpoint. The unmodified board page links a Google Fonts stylesheet that this policy
blocks (a known message in the browser console; system fonts are used and nothing is requested from
Google).

## Job Options Reference

```typescript
interface JobOptions {
  priority?: number // 0 = none; positive: lower runs first (BullMQ)
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
    `void queue.getBackend().client.then(...)` → `queue.redis_reconnecting`
    (warn). It is **never awaited**: `queue.getBackend().client` (BullMQ 6's
    Redis-specific escape hatch, replacing the removed `Queue#client`) is
    BullMQ's ready-gated promise and may never settle while Redis is down, so
    awaiting it would hang bootstrap.
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
