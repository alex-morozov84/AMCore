import { notificationsWork } from './core/notifications/notifications.work'
import { aiRunsWork } from './infrastructure/ai/runs/ai-runs.work'
import { defineWork, type WorkRegistration } from './infrastructure/background-work/work-definition'
import { emailWork } from './infrastructure/email/email.work'

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
    definition: emailWork,
    core: async () => (await import('./infrastructure/email/email.module')).EmailModule,
    worker: async () =>
      (await import('./infrastructure/email/email-worker.module')).EmailWorkerModule,
  },
  {
    definition: defaultWork,
    core: async () => (await import('./infrastructure/queue/queue.module')).QueueModule,
  },
  {
    definition: notificationsWork,
    core: async () =>
      (await import('./core/notifications/notifications.module')).NotificationsModule,
    worker: async () =>
      (await import('./core/notifications/notifications-worker.module')).NotificationsWorkerModule,
  },
  {
    definition: aiRunsWork,
    core: async () => (await import('./infrastructure/ai/ai-catalog.module')).AiCatalogModule,
    worker: async () => (await import('./infrastructure/ai/ai-worker.module')).AiWorkerModule,
  },
] as const satisfies readonly WorkRegistration[]
