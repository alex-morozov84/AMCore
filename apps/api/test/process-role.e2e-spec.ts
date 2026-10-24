import { DiscoveryService, MetadataScanner } from '@nestjs/core'
import { ScheduleExplorer, SchedulerRegistry } from '@nestjs/schedule'
import { Test, type TestingModule } from '@nestjs/testing'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { PinoLogger } from 'nestjs-pino'

import type { ScheduledJobDefinition } from '../src/infrastructure/schedule/scheduled-job'

import { e2eContainerLabels } from './e2e-owned-containers'

/**
 * Role-composition DI assertions (ADR-041). Lives in the e2e (ESM) project so the
 * full app graph (jose/openid-client) parses. Uses `.compile()` — it resolves the
 * DI graph WITHOUT `onModuleInit`. Isolated containers still bound constructor-side broker initialization — plus
 * a no-op `PinoLogger` (the real nestjs-pino provider hangs `compile()`).
 *
 * App modules are imported dynamically after the test env is set. A static
 * AppModule/WebModule import evaluates ConfigModule.forRoot() before Jest
 * `beforeAll`, which fails in CI where no project `.env` exists.
 */

/* eslint jest/expect-expect: ["error", { "assertFunctionNames": ["expect", "present", "absent"] }] */

type Token = any

let AppModule: Token
let WebModule: Token
let WorkerModule: Token
let AdminController: Token
let AdminQueuesController: Token
let AdminIntegrationsController: Token
let IntegrationRegistry: Token
let QueueObservationService: Token
let AuthController: Token
let EmailProcessor: Token
let postgres: StartedPostgreSqlContainer
let broker: StartedRedisContainer
let NotificationDispatchProcessor: Token
let NotificationRetentionService: Token
let NotificationRealtimePublisher: Token
let NotificationRealtimeSubscriber: Token
let NotificationRealtimeHub: Token
let NotificationStreamController: Token
let MetricsService: Token
let QueueDepthMetricsCollector: Token
let QueueService: Token
let TelegramController: Token
let TelegramWebhookController: Token
let TelegramChannelDeliverer: Token
let TelegramBotApiClient: Token
// Telegram reachability check: the process that sends is the process that checks.
let TelegramReachabilityService: Token
// AI capability layer (Track C — ADR-054, Arc C)
let ModelGateway: Token
let AiProviderAdaptersToken: Token
let AiRunExecutorService: Token
let AiRunLoopExecutor: Token
let AiRunApprovalParker: Token
let AiApprovalExpiryService: Token
let AiToolRegistry: Token
let AiToolActionService: Token
let AiToolRecoveryService: Token
let AiRunGuard: Token
let AiRunTransitions: Token
let AiRunDispatchProcessor: Token
let AiRunRecoveryService: Token
let AiRunRealtimePublisher: Token
let AiRunRealtimeSubscriber: Token
let AiRunRealtimeHub: Token
let AiRunStreamController: Token
let AiRunsController: Token
let AiConversationsController: Token
let AiApprovalsController: Token
let AiApprovalService: Token
// AI human takeover / operator review (Track C — ADR-054, Arc F)
let AiConversationControlController: Token
let AiConversationControlService: Token
let AiConversationOperatorService: Token
let AiAssistantAdminController: Token
let AiAssistantAdminService: Token
// AI multimodal artifacts (Track C — ADR-054, Arc G)
let AiArtifactsController: Token
let AiArtifactUploadService: Token
let AiArtifactDownloadService: Token
let SCHEDULED_JOBS: readonly ScheduledJobDefinition[]
let SCHEDULED_JOB_METADATA: string

const noopPinoLogger = {
  setContext: () => undefined,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  assign: () => undefined,
} as unknown as PinoLogger

async function compileRole(root: Token): Promise<TestingModule> {
  return Test.createTestingModule({ imports: [root] })
    .overrideProvider(PinoLogger)
    .useValue(noopPinoLogger)
    .overrideProvider(QueueService)
    .useValue({
      getQueue: (queueName: string) => ({
        getJobCounts: async () => ({
          waiting: queueName === 'email' ? 2 : 1,
          active: 0,
        }),
      }),
      add: async () => undefined,
    })
    .compile()
}

/**
 * What the real scheduler would register for this graph. It runs Nest's own explorer (the code that
 * reads @Cron/@Interval from every provider) without mounting any timer, so a job that bypasses the
 * catalogue, is missing, is registered twice or is present in the wrong role is seen here.
 */
function scheduledNames(m: TestingModule): string[] {
  const explorer = m.get(ScheduleExplorer, { strict: false }) as unknown as {
    explore(): void
    schedulerOrchestrator: {
      cronJobs: Record<string, { options: { cronTime: string; timeZone?: string } }>
      intervals: Record<string, { timeout: number }>
      timeouts: Record<string, unknown>
    }
  }
  explorer.explore()
  const { cronJobs, intervals, timeouts } = explorer.schedulerOrchestrator
  expect(Object.keys(timeouts)).toEqual([])
  // What the scheduler holds is exactly what the definition declares (the tick times of each job).
  for (const job of SCHEDULED_JOBS) {
    if (job.schedule.kind === 'cron') {
      expect(cronJobs[job.id]?.options.cronTime).toBe(job.schedule.expression)
      expect(cronJobs[job.id]?.options.timeZone).toBe(job.schedule.timeZone ?? undefined)
    } else expect(intervals[job.id]?.timeout).toBe(job.schedule.everyMs)
  }
  return [...Object.keys(cronJobs), ...Object.keys(intervals)].sort()
}

/** Methods carrying a scheduler decorator but not the catalogue tag: a bypass of @ScheduledJob. */
function untaggedSchedulerMethods(m: TestingModule): string[] {
  const discovery = m.get(DiscoveryService, { strict: false })
  const scanner = m.get(MetadataScanner, { strict: false })
  const offenders: string[] = []
  for (const wrapper of [...discovery.getControllers(), ...discovery.getProviders()]) {
    const proto = wrapper.instance && Object.getPrototypeOf(wrapper.instance)
    if (!proto) continue
    for (const name of scanner.getAllMethodNames(proto)) {
      const method = proto[name]
      if (
        Reflect.getMetadata('SCHEDULER_TYPE', method) !== undefined &&
        Reflect.getMetadata(SCHEDULED_JOB_METADATA, method) === undefined
      )
        offenders.push(`${proto.constructor.name}.${name}`)
    }
  }
  return offenders
}
const catalogueIds = (): string[] => SCHEDULED_JOBS.map((job) => job.id).sort()

const present = (m: TestingModule, token: Token): void =>
  expect(() => m.get(token, { strict: false })).not.toThrow()
const absent = (m: TestingModule, token: Token): void =>
  expect(() => m.get(token, { strict: false })).toThrow()

describe('PROCESS_ROLE module composition (ADR-041)', () => {
  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:18-alpine')
      .withLabels(e2eContainerLabels())
      .start()
    broker = await new RedisContainer('redis:7-alpine').withLabels(e2eContainerLabels()).start()
    process.env.DATABASE_URL = postgres.getConnectionUri()
    process.env.REDIS_URL = broker.getConnectionUrl()
    process.env.JWT_SECRET ??= 'test-only-jwt-secret-at-least-32-characters-long'

    const appModule = await import('../src/app.module')
    const webModule = await import('../src/web.module')
    const workerModule = await import('../src/worker.module')
    const adminController = await import('../src/core/admin/admin.controller')
    const authController = await import('../src/core/auth/auth.controller')
    const emailProcessor = await import('../src/infrastructure/email/queued-email.handler')
    const dispatchProcessor =
      await import('../src/core/notifications/dispatch/notification-dispatch.processor')
    const retentionService =
      await import('../src/core/notifications/notification-retention.service')
    const realtimePublisher =
      await import('../src/core/notifications/realtime/notification-realtime.publisher')
    const realtimeSubscriber =
      await import('../src/core/notifications/realtime/notification-realtime.subscriber')
    const realtimeHub = await import('../src/core/notifications/realtime/notification-realtime.hub')
    const streamController =
      await import('../src/core/notifications/notification-stream.controller')
    const observability = await import('../src/infrastructure/observability')
    const queue = await import('../src/infrastructure/queue')
    const adminQueuesController = await import('../src/core/admin/admin-queues.controller')
    const adminIntegrationsController =
      await import('../src/core/admin/admin-integrations.controller')
    const integrationRegistry = await import('../src/core/admin/integrations/integration-registry')
    const tgController =
      await import('../src/core/notifications/channels/telegram/telegram.controller')
    const tgWebhookController =
      await import('../src/core/notifications/channels/telegram/telegram-webhook.controller')
    const tgDeliverer =
      await import('../src/core/notifications/channels/telegram/telegram-channel.deliverer')
    const tgClient =
      await import('../src/core/notifications/channels/telegram/telegram-bot-api.client')
    const tgReachability =
      await import('../src/core/notifications/channels/telegram/telegram-reachability.service')
    const modelGateway = await import('../src/infrastructure/ai/gateway/model-gateway.service')
    const aiGatewayTypes = await import('../src/infrastructure/ai/gateway/ai-gateway.types')
    const aiExecutor = await import('../src/infrastructure/ai/runs/ai-run-executor.service')
    const aiLoop = await import('../src/infrastructure/ai/runs/ai-run-loop-executor.service')
    const aiParker = await import('../src/infrastructure/ai/runs/ai-run-approval-parker.service')
    const aiExpiry = await import('../src/infrastructure/ai/runs/ai-approval-expiry.service')
    const aiToolRegistry = await import('../src/infrastructure/ai/tools/ai-tool-registry.service')
    const aiToolAction = await import('../src/infrastructure/ai/runs/ai-tool-action.service')
    const aiToolRecovery = await import('../src/infrastructure/ai/runs/ai-tool-recovery.service')
    const aiRunGuard = await import('../src/infrastructure/ai/runs/ai-run-guard.service')
    const aiTransitions = await import('../src/infrastructure/ai/runs/ai-run-transitions.service')
    const aiProcessor = await import('../src/infrastructure/ai/runs/ai-run-dispatch.processor')
    const aiRecovery = await import('../src/infrastructure/ai/runs/ai-run-recovery.service')
    const aiPublisher = await import('../src/core/ai/realtime/ai-run-realtime.publisher')
    const aiSubscriber = await import('../src/core/ai/realtime/ai-run-realtime.subscriber')
    const aiHub = await import('../src/core/ai/realtime/ai-run-realtime.hub')
    const aiStreamController = await import('../src/core/ai/realtime/ai-run-stream.controller')
    const aiRunsController = await import('../src/core/ai/runs/ai-runs.controller')
    const aiConversationsController =
      await import('../src/core/ai/conversations/ai-conversations.controller')
    const aiApprovalsController = await import('../src/core/ai/approvals/ai-approvals.controller')
    const aiApprovalService = await import('../src/core/ai/approvals/ai-approval.service')
    const aiControlController =
      await import('../src/core/ai/conversations/ai-conversation-control.controller')
    const aiControlService =
      await import('../src/core/ai/conversations/ai-conversation-control.service')
    const aiOperatorService =
      await import('../src/core/ai/conversations/ai-conversation-operator.service')
    const aiAssistantAdminController =
      await import('../src/core/ai/admin/ai-assistant-admin.controller')
    const aiAssistantAdminService = await import('../src/core/ai/admin/ai-assistant-admin.service')
    const aiArtifactsController = await import('../src/core/ai/artifacts/ai-artifacts.controller')
    const aiArtifactUploadService =
      await import('../src/core/ai/artifacts/ai-artifact-upload.service')
    const aiArtifactDownloadService =
      await import('../src/core/ai/artifacts/ai-artifact-download.service')

    const jobs = await import('../src/infrastructure/schedule/scheduled-jobs.catalogue')
    const jobDecorator = await import('../src/infrastructure/schedule/scheduled-job')
    SCHEDULED_JOBS = jobs.SCHEDULED_JOBS
    SCHEDULED_JOB_METADATA = jobDecorator.SCHEDULED_JOB_METADATA
    AppModule = appModule.AppModule
    WebModule = webModule.WebModule
    WorkerModule = workerModule.WorkerModule
    AdminController = adminController.AdminController
    AuthController = authController.AuthController
    EmailProcessor = emailProcessor.QueuedEmailHandler
    NotificationDispatchProcessor = dispatchProcessor.NotificationDispatchProcessor
    NotificationRetentionService = retentionService.NotificationRetentionService
    NotificationRealtimePublisher = realtimePublisher.NotificationRealtimePublisher
    NotificationRealtimeSubscriber = realtimeSubscriber.NotificationRealtimeSubscriber
    NotificationRealtimeHub = realtimeHub.NotificationRealtimeHub
    NotificationStreamController = streamController.NotificationStreamController
    MetricsService = observability.MetricsService
    QueueDepthMetricsCollector = queue.QueueDepthMetricsCollector
    QueueService = queue.QueueService
    QueueObservationService = queue.QueueObservationService
    AdminQueuesController = adminQueuesController.AdminQueuesController
    AdminIntegrationsController = adminIntegrationsController.AdminIntegrationsController
    IntegrationRegistry = integrationRegistry.IntegrationRegistry
    TelegramController = tgController.TelegramController
    TelegramWebhookController = tgWebhookController.TelegramWebhookController
    TelegramChannelDeliverer = tgDeliverer.TelegramChannelDeliverer
    TelegramBotApiClient = tgClient.TelegramBotApiClient
    TelegramReachabilityService = tgReachability.TelegramReachabilityService
    ModelGateway = modelGateway.ModelGateway
    AiProviderAdaptersToken = aiGatewayTypes.AI_PROVIDER_ADAPTERS
    AiRunExecutorService = aiExecutor.AiRunExecutorService
    AiRunLoopExecutor = aiLoop.AiRunLoopExecutor
    AiRunApprovalParker = aiParker.AiRunApprovalParker
    AiApprovalExpiryService = aiExpiry.AiApprovalExpiryService
    AiToolRegistry = aiToolRegistry.AiToolRegistry
    AiToolActionService = aiToolAction.AiToolActionService
    AiToolRecoveryService = aiToolRecovery.AiToolRecoveryService
    AiRunGuard = aiRunGuard.AiRunGuard
    AiRunTransitions = aiTransitions.AiRunTransitions
    AiRunDispatchProcessor = aiProcessor.AiRunDispatchProcessor
    AiRunRecoveryService = aiRecovery.AiRunRecoveryService
    AiRunRealtimePublisher = aiPublisher.AiRunRealtimePublisher
    AiRunRealtimeSubscriber = aiSubscriber.AiRunRealtimeSubscriber
    AiRunRealtimeHub = aiHub.AiRunRealtimeHub
    AiRunStreamController = aiStreamController.AiRunStreamController
    AiRunsController = aiRunsController.AiRunsController
    AiConversationsController = aiConversationsController.AiConversationsController
    AiApprovalsController = aiApprovalsController.AiApprovalsController
    AiApprovalService = aiApprovalService.AiApprovalService
    AiConversationControlController = aiControlController.AiConversationControlController
    AiConversationControlService = aiControlService.AiConversationControlService
    AiConversationOperatorService = aiOperatorService.AiConversationOperatorService
    AiAssistantAdminController = aiAssistantAdminController.AiAssistantAdminController
    AiArtifactsController = aiArtifactsController.AiArtifactsController
    AiArtifactUploadService = aiArtifactUploadService.AiArtifactUploadService
    AiArtifactDownloadService = aiArtifactDownloadService.AiArtifactDownloadService
    AiAssistantAdminService = aiAssistantAdminService.AiAssistantAdminService
  }, 120000)

  afterAll(async () => {
    await broker?.stop()
    await postgres?.stop()
  }, 60000)

  describe('web', () => {
    let m: TestingModule
    beforeAll(async () => {
      m = await compileRole(WebModule)
    }, 60000)
    afterAll(async () => {
      await m?.close()
    })

    it('has queue producers and business controllers', () => {
      present(m, QueueService)
      present(m, AuthController)
      present(m, AdminController)
    })

    it('observes queues read-only and serves the Console summary (no worker needed)', () => {
      present(m, QueueObservationService)
      present(m, AdminQueuesController)
      present(m, AdminIntegrationsController)
      present(m, IntegrationRegistry)
    })

    it('has no scheduler explorer and no scheduler-decorated method outside the catalogue', () => {
      absent(m, ScheduleExplorer)
      expect(untaggedSchedulerMethods(m)).toEqual([])
    })

    it('has NO BullMQ worker and NO scheduler (so @Cron never fires)', () => {
      absent(m, EmailProcessor)
      absent(m, NotificationDispatchProcessor)
      absent(m, NotificationRetentionService)
      absent(m, QueueDepthMetricsCollector)
      absent(m, SchedulerRegistry)
    })

    it('has the realtime publisher, subscriber, hub, and SSE stream route (ADR-053)', () => {
      present(m, NotificationRealtimePublisher)
      present(m, NotificationRealtimeSubscriber)
      present(m, NotificationRealtimeHub)
      present(m, NotificationStreamController)
    })

    it('does not register the shared queue-depth gauge', async () => {
      const output = await m.get(MetricsService, { strict: false }).metrics()
      expect(output).not.toContain('amcore_queue_jobs')
    })

    it('has the Telegram linking surface but NOT the worker-only Bot client/deliverer (Arc D)', () => {
      present(m, TelegramController)
      present(m, TelegramWebhookController)
      absent(m, TelegramChannelDeliverer)
      absent(m, TelegramBotApiClient)
      absent(m, TelegramReachabilityService)
    })

    it('has the AI HTTP surface + SSE stream/hub/subscriber but NO provider I/O or worker (Track C)', () => {
      // Business HTTP + the SSE receive side are web-only.
      present(m, AiRunsController)
      present(m, AiConversationsController)
      present(m, AiApprovalsController)
      present(m, AiApprovalService)
      // Arc F: human takeover / operator review + assistant admin are web-only.
      present(m, AiConversationControlController)
      present(m, AiConversationControlService)
      present(m, AiConversationOperatorService)
      present(m, AiAssistantAdminController)
      present(m, AiAssistantAdminService)
      // Arc G: artifact upload/download are web-only (Postgres + storage I/O, no provider call).
      present(m, AiArtifactsController)
      present(m, AiArtifactUploadService)
      present(m, AiArtifactDownloadService)
      present(m, AiRunStreamController)
      present(m, AiRunRealtimeHub)
      present(m, AiRunRealtimeSubscriber)
      // Provider-call capability (the gateway seam AND the SDK/provider adapters) + the durable
      // worker never enter the web DI graph.
      absent(m, ModelGateway)
      absent(m, AiProviderAdaptersToken)
      absent(m, AiRunExecutorService)
      absent(m, AiRunDispatchProcessor)
      absent(m, AiRunRecoveryService)
      // The Arc E bounded tool loop + code-owned tool registry/dispatcher are worker-only — the model
      // can never reach a tool (or the loop that runs it) from the web DI graph.
      absent(m, AiRunLoopExecutor)
      absent(m, AiRunApprovalParker)
      absent(m, AiApprovalExpiryService)
      absent(m, AiToolRegistry)
      absent(m, AiToolActionService)
      absent(m, AiToolRecoveryService)
      // The ownership guard + transitions fence every durable run write: worker-only like the loop.
      absent(m, AiRunGuard)
      absent(m, AiRunTransitions)
      // The publisher is worker-only (only the worker emits run-status hints in Arc C).
      absent(m, AiRunRealtimePublisher)
    })
  })

  describe('worker', () => {
    let m: TestingModule
    beforeAll(async () => {
      m = await compileRole(WorkerModule)
    }, 60000)
    afterAll(async () => {
      await m?.close()
    })

    it('registers exactly the catalogue with the scheduler: each job once, nothing else', () => {
      expect(scheduledNames(m)).toEqual(catalogueIds())
      expect(untaggedSchedulerMethods(m)).toEqual([])
    })

    it('has the BullMQ processor and the scheduler', () => {
      present(m, EmailProcessor)
      present(m, NotificationDispatchProcessor)
      present(m, NotificationRetentionService)
      present(m, QueueDepthMetricsCollector)
      present(m, SchedulerRegistry)
    })

    it('registers the shared queue-depth gauge', async () => {
      const output = await m.get(MetricsService, { strict: false }).metrics()
      expect(output).toContain('amcore_queue_jobs{queue="email",state="waiting"')
    })

    it('has NO business controllers (probe/scrape-only HTTP surface)', () => {
      absent(m, AuthController)
      absent(m, AdminController)
      absent(m, AdminQueuesController)
      absent(m, AdminIntegrationsController)
      absent(m, IntegrationRegistry)
    })

    it('keeps the shared queue inventory/observation provider with the core queue module', () => {
      present(m, QueueObservationService)
    })

    it('may publish realtime hints but holds NO subscriber, hub, or stream route', () => {
      present(m, NotificationRealtimePublisher)
      absent(m, NotificationRealtimeSubscriber)
      absent(m, NotificationRealtimeHub)
      absent(m, NotificationStreamController)
    })

    it('has the Telegram Bot client + deliverer but NOT the web link/webhook controllers (Arc D)', () => {
      present(m, TelegramChannelDeliverer)
      present(m, TelegramBotApiClient)
      present(m, TelegramReachabilityService)
      absent(m, TelegramController)
      absent(m, TelegramWebhookController)
    })

    it('has provider I/O + the durable AI worker but NO AI HTTP controllers or SSE receive side (Track C)', () => {
      // The worker is the only role that calls providers (gateway seam + SDK adapters) and runs
      // the durable executor/recovery.
      present(m, ModelGateway)
      present(m, AiProviderAdaptersToken)
      present(m, AiRunExecutorService)
      present(m, AiRunLoopExecutor)
      present(m, AiRunApprovalParker)
      present(m, AiApprovalExpiryService)
      present(m, AiToolRegistry)
      present(m, AiToolActionService)
      present(m, AiToolRecoveryService)
      present(m, AiRunGuard)
      present(m, AiRunTransitions)
      present(m, AiRunDispatchProcessor)
      present(m, AiRunRecoveryService)
      // It publishes run-status hints, but hosts no AI HTTP surface and no SSE receive side.
      present(m, AiRunRealtimePublisher)
      absent(m, AiRunsController)
      absent(m, AiConversationsController)
      absent(m, AiApprovalsController)
      absent(m, AiApprovalService)
      // Arc F takeover/operator + assistant admin never enter the worker DI graph.
      absent(m, AiConversationControlController)
      absent(m, AiConversationControlService)
      absent(m, AiConversationOperatorService)
      absent(m, AiAssistantAdminController)
      absent(m, AiAssistantAdminService)
      absent(m, AiArtifactsController)
      absent(m, AiArtifactUploadService)
      absent(m, AiArtifactDownloadService)
      absent(m, AiRunStreamController)
      absent(m, AiRunRealtimeHub)
      absent(m, AiRunRealtimeSubscriber)
    })
  })

  describe('all', () => {
    let m: TestingModule
    beforeAll(async () => {
      m = await compileRole(AppModule)
    }, 60000)
    afterAll(async () => {
      await m?.close()
    })

    it('registers exactly the catalogue with the scheduler: each job once, nothing else', () => {
      expect(scheduledNames(m)).toEqual(catalogueIds())
      expect(untaggedSchedulerMethods(m)).toEqual([])
    })

    it('composes web + worker: controllers, producer, processor, and scheduler', () => {
      present(m, AuthController)
      present(m, AdminController)
      present(m, QueueService)
      present(m, EmailProcessor)
      present(m, NotificationDispatchProcessor)
      present(m, NotificationRetentionService)
      present(m, QueueDepthMetricsCollector)
      present(m, SchedulerRegistry)
      present(m, QueueObservationService)
      present(m, AdminQueuesController)
      present(m, AdminIntegrationsController)
      present(m, IntegrationRegistry)
    })

    it('composes the realtime publisher, subscriber, hub, and stream route', () => {
      present(m, NotificationRealtimePublisher)
      present(m, NotificationRealtimeSubscriber)
      present(m, NotificationRealtimeHub)
      present(m, NotificationStreamController)
    })

    it('registers the shared queue-depth gauge', async () => {
      const output = await m.get(MetricsService, { strict: false }).metrics()
      expect(output).toContain('amcore_queue_jobs{queue="default",state="waiting"')
    })

    it('composes the full Telegram surface — link/webhook controllers AND Bot client/deliverer', () => {
      present(m, TelegramController)
      present(m, TelegramWebhookController)
      present(m, TelegramChannelDeliverer)
      present(m, TelegramBotApiClient)
      present(m, TelegramReachabilityService)
    })

    it('composes both AI sides — HTTP + provider I/O + worker AND the SSE stream/hub/subscriber (Track C)', () => {
      present(m, AiRunsController)
      present(m, AiConversationsController)
      present(m, AiApprovalsController)
      present(m, AiApprovalService)
      present(m, AiConversationControlController)
      present(m, AiConversationOperatorService)
      present(m, AiAssistantAdminController)
      present(m, AiArtifactsController)
      present(m, AiArtifactUploadService)
      present(m, AiArtifactDownloadService)
      present(m, ModelGateway)
      present(m, AiProviderAdaptersToken)
      present(m, AiRunExecutorService)
      present(m, AiRunDispatchProcessor)
      present(m, AiRunRecoveryService)
      present(m, AiRunRealtimePublisher)
      present(m, AiRunStreamController)
      present(m, AiRunRealtimeHub)
      present(m, AiRunRealtimeSubscriber)
    })
  })
})
