import { aiRunExecutionsWork } from './core/ai/control/ai-run-executions.work.js'
import { notificationDeliveriesWork } from './core/notifications/control/notification-deliveries.work.js'
import { notificationsWork } from './core/notifications/notifications.work.js'
import { aiRunsWork } from './infrastructure/ai/runs/ai-runs.work.js'
import {
  defineWork,
  type WorkRegistration,
} from './infrastructure/background-work/work-definition.js'
import { emailWork } from './infrastructure/email/email.work.js'

const defaultWork = defineWork({
  id: 'default',
  presentation: { name: { en: 'Default queue', ru: 'Общая очередь' }, fields: {} },
  definitionVersion: 1,
  kind: 'external',
  queue: { name: 'default', enabled: true },
  jobs: {},
})

/** One application registration collection. Lazy loaders keep executable workers out of web. */
export const BACKGROUND_WORK = [
  {
    definition: aiRunExecutionsWork,
    core: async () => (await import('./core/ai/control/ai-work.module.js')).AiWorkModule,
    control: async () => (await import('./core/ai/control/ai-work.module.js')).AiWorkModule,
  },
  {
    definition: notificationDeliveriesWork,
    core: async () =>
      (await import('./core/notifications/control/notification-work.module.js'))
        .NotificationWorkModule,
    control: async () =>
      (await import('./core/notifications/control/notification-work.module.js'))
        .NotificationWorkModule,
  },
  {
    definition: emailWork,
    core: async () => (await import('./infrastructure/email/email.module.js')).EmailModule,
    worker: async () =>
      (await import('./infrastructure/email/email-worker.module.js')).EmailWorkerModule,
  },
  {
    definition: defaultWork,
    core: async () => (await import('./infrastructure/queue/queue.module.js')).QueueModule,
  },
  {
    definition: notificationsWork,
    core: async () =>
      (await import('./core/notifications/notifications.module.js')).NotificationsModule,
    worker: async () =>
      (await import('./core/notifications/notifications-worker.module.js'))
        .NotificationsWorkerModule,
  },
  {
    definition: aiRunsWork,
    core: async () => (await import('./infrastructure/ai/ai-catalog.module.js')).AiCatalogModule,
    worker: async () => (await import('./infrastructure/ai/ai-worker.module.js')).AiWorkerModule,
  },
] as const satisfies readonly WorkRegistration[]
