import { SchedulerRegistry } from '@nestjs/schedule'
import { Test, type TestingModule } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'

/**
 * Role-composition DI assertions (ADR-041). Lives in the e2e (ESM) project so the
 * full app graph (jose/openid-client) parses. Uses `.compile()` — it resolves the
 * DI graph WITHOUT `onModuleInit`, so no Redis/Postgres connection is made — plus
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
let AuthController: Token
let EmailProcessor: Token
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
// AI capability layer (Track C — ADR-054, Arc C)
let ModelGateway: Token
let AiProviderAdaptersToken: Token
let AiRunExecutorService: Token
let AiRunLoopExecutor: Token
let AiRunApprovalParker: Token
let AiApprovalExpiryService: Token
let AiToolRegistry: Token
let AiToolDispatcher: Token
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

const present = (m: TestingModule, token: Token): void =>
  expect(() => m.get(token, { strict: false })).not.toThrow()
const absent = (m: TestingModule, token: Token): void =>
  expect(() => m.get(token, { strict: false })).toThrow()

describe('PROCESS_ROLE module composition (ADR-041)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/test?schema=public'
    process.env.REDIS_URL ??= 'redis://localhost:6379'
    process.env.JWT_SECRET ??= 'test-only-jwt-secret-at-least-32-characters-long'

    const appModule = await import('../src/app.module')
    const webModule = await import('../src/web.module')
    const workerModule = await import('../src/worker.module')
    const adminController = await import('../src/core/admin/admin.controller')
    const authController = await import('../src/core/auth/auth.controller')
    const emailProcessor = await import('../src/infrastructure/email/processors/email.processor')
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
    const tgController =
      await import('../src/core/notifications/channels/telegram/telegram.controller')
    const tgWebhookController =
      await import('../src/core/notifications/channels/telegram/telegram-webhook.controller')
    const tgDeliverer =
      await import('../src/core/notifications/channels/telegram/telegram-channel.deliverer')
    const tgClient =
      await import('../src/core/notifications/channels/telegram/telegram-bot-api.client')
    const modelGateway = await import('../src/infrastructure/ai/gateway/model-gateway.service')
    const aiGatewayTypes = await import('../src/infrastructure/ai/gateway/ai-gateway.types')
    const aiExecutor = await import('../src/infrastructure/ai/runs/ai-run-executor.service')
    const aiLoop = await import('../src/infrastructure/ai/runs/ai-run-loop-executor.service')
    const aiParker = await import('../src/infrastructure/ai/runs/ai-run-approval-parker.service')
    const aiExpiry = await import('../src/infrastructure/ai/runs/ai-approval-expiry.service')
    const aiToolRegistry = await import('../src/infrastructure/ai/tools/ai-tool-registry.service')
    const aiToolDispatcher =
      await import('../src/infrastructure/ai/runs/ai-tool-dispatcher.service')
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

    AppModule = appModule.AppModule
    WebModule = webModule.WebModule
    WorkerModule = workerModule.WorkerModule
    AdminController = adminController.AdminController
    AuthController = authController.AuthController
    EmailProcessor = emailProcessor.EmailProcessor
    NotificationDispatchProcessor = dispatchProcessor.NotificationDispatchProcessor
    NotificationRetentionService = retentionService.NotificationRetentionService
    NotificationRealtimePublisher = realtimePublisher.NotificationRealtimePublisher
    NotificationRealtimeSubscriber = realtimeSubscriber.NotificationRealtimeSubscriber
    NotificationRealtimeHub = realtimeHub.NotificationRealtimeHub
    NotificationStreamController = streamController.NotificationStreamController
    MetricsService = observability.MetricsService
    QueueDepthMetricsCollector = queue.QueueDepthMetricsCollector
    QueueService = queue.QueueService
    TelegramController = tgController.TelegramController
    TelegramWebhookController = tgWebhookController.TelegramWebhookController
    TelegramChannelDeliverer = tgDeliverer.TelegramChannelDeliverer
    TelegramBotApiClient = tgClient.TelegramBotApiClient
    ModelGateway = modelGateway.ModelGateway
    AiProviderAdaptersToken = aiGatewayTypes.AI_PROVIDER_ADAPTERS
    AiRunExecutorService = aiExecutor.AiRunExecutorService
    AiRunLoopExecutor = aiLoop.AiRunLoopExecutor
    AiRunApprovalParker = aiParker.AiRunApprovalParker
    AiApprovalExpiryService = aiExpiry.AiApprovalExpiryService
    AiToolRegistry = aiToolRegistry.AiToolRegistry
    AiToolDispatcher = aiToolDispatcher.AiToolDispatcher
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
    AiAssistantAdminService = aiAssistantAdminService.AiAssistantAdminService
  })

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
      absent(m, AiToolDispatcher)
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
      present(m, AiToolDispatcher)
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

    it('composes web + worker: controllers, producer, processor, and scheduler', () => {
      present(m, AuthController)
      present(m, AdminController)
      present(m, QueueService)
      present(m, EmailProcessor)
      present(m, NotificationDispatchProcessor)
      present(m, NotificationRetentionService)
      present(m, QueueDepthMetricsCollector)
      present(m, SchedulerRegistry)
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
    })

    it('composes both AI sides — HTTP + provider I/O + worker AND the SSE stream/hub/subscriber (Track C)', () => {
      present(m, AiRunsController)
      present(m, AiConversationsController)
      present(m, AiApprovalsController)
      present(m, AiApprovalService)
      present(m, AiConversationControlController)
      present(m, AiConversationOperatorService)
      present(m, AiAssistantAdminController)
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
