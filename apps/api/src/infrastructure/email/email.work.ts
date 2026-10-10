import { defineOrdinaryWork } from '../background-work/work-definition'
import { JobName, QueueName } from '../queue/constants/queues.constant'

import { type SendEmailJobData, sendEmailJobDataSchema } from './email.schema'

export const emailWork = defineOrdinaryWork({
  id: 'email',
  presentation: {
    name: { en: 'Email delivery', ru: 'Отправка писем' },
    fields: {
      template: { en: 'Template', ru: 'Шаблон' },
      userId: { en: 'User ID', ru: 'Идентификатор пользователя' },
    },
  },
  definitionVersion: 1,
  queue: { name: QueueName.EMAIL, enabled: true },
  jobs: {
    [JobName.SEND_EMAIL]: {
      wireVersion: 1,
      schema: sendEmailJobDataSchema,
      replay: { kind: 'provider-window', policyVersion: 1, recipe: 'queued-email' },
      project: (payload: SendEmailJobData) => ({
        template: payload.template,
        ...(payload.userId ? { userId: payload.userId } : {}),
      }),
      retention: { completedMs: 3600000, failedMs: 86400000 },
    },
  },
})
