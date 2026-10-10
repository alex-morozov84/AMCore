import { type DispatchDueJob, dispatchDueJobSchema } from './notification-dispatch.schema'

import { defineWork } from '@/infrastructure/background-work/work-definition'
import { JobName, QueueName } from '@/infrastructure/queue/constants/queues.constant'

export const notificationsWork = defineWork({
  id: 'notifications',
  presentation: {
    name: { en: 'Notifications', ru: 'Уведомления' },
    fields: { notificationId: { en: 'Notification ID', ru: 'Идентификатор уведомления' } },
  },
  definitionVersion: 1,
  kind: 'wake',
  legacy: { kind: 'wake-hint' },
  queue: { name: QueueName.NOTIFICATIONS, enabled: true },
  jobs: {
    [JobName.DISPATCH_DUE]: {
      wireVersion: 1,
      schema: dispatchDueJobSchema,
      replay: { kind: 'unsupported', policyVersion: 1 },
      project: (payload: DispatchDueJob): Readonly<Record<string, string>> =>
        payload.notificationId ? { notificationId: payload.notificationId } : {},
      retention: { completedMs: 3600000, failedMs: 86400000 },
    },
  },
})
