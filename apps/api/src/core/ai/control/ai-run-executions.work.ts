import { defineDurableWork } from '../../../infrastructure/background-work/index.js'

export const aiRunExecutionsWork = defineDurableWork({
  id: 'ai-run-executions',
  definitionVersion: 1,
  failureReasons: {
    provider_timeout: { title: { en: 'Provider timeout', ru: 'Тайм-аут провайдера' } },
    provider_unavailable: { title: { en: 'Provider unavailable', ru: 'Провайдер недоступен' } },
    lease_expired: { title: { en: 'Lease expired', ru: 'Срок аренды истёк' } },
    tool_effect_unknown: {
      title: { en: 'Tool effect uncertain', ru: 'Эффект инструмента неизвестен' },
    },
  },
  presentation: {
    name: { en: 'AI run executions', ru: 'Выполнение AI-запусков' },
    filters: [
      {
        key: 'status',
        label: { en: 'Run state', ru: 'Состояние запуска' },
        options: [
          ['QUEUED', 'Queued', 'В очереди'],
          ['RUNNING', 'Running', 'Выполняется'],
          ['WAITING_APPROVAL', 'Waiting for approval', 'Ждёт подтверждения'],
          ['WAITING_HUMAN', 'Waiting for human', 'Ждёт человека'],
          ['COMPLETED', 'Completed', 'Завершён'],
          ['FAILED', 'Failed', 'Ошибка'],
          ['CANCELLED', 'Cancelled', 'Отменён'],
          ['EXPIRED', 'Expired', 'Срок истёк'],
        ].map(([value, en, ru]) => ({ value: value!, label: { en: en!, ru: ru! } })),
      },
    ],
    fields: {
      status: { en: 'Run state', ru: 'Состояние запуска' },
      model: { en: 'Model', ru: 'Модель' },
      attempts: { en: 'Attempts', ru: 'Попытки' },
      lease: { en: 'Lease expires', ru: 'Срок аренды' },
      deadline: { en: 'Run deadline', ru: 'Срок запуска' },
      approval: { en: 'Approval expires', ru: 'Срок подтверждения' },
      cancel: { en: 'Cancellation requested', ru: 'Запрошена отмена' },
      lineage: { en: 'Original run', ru: 'Исходный запуск' },
    },
    technicalFields: ['lineage'],
    attemptHistory: true,
    nativeStates: {
      QUEUED: { en: 'Queued', ru: 'В очереди' },
      RUNNING: { en: 'Running', ru: 'Выполняется' },
      WAITING_APPROVAL: { en: 'Waiting for approval', ru: 'Ждёт подтверждения' },
      WAITING_HUMAN: { en: 'Waiting for human', ru: 'Ждёт человека' },
      COMPLETED: { en: 'Completed', ru: 'Завершён' },
      FAILED: { en: 'Failed', ru: 'Ошибка' },
      CANCELLED: { en: 'Cancelled', ru: 'Отменён' },
      EXPIRED: { en: 'Expired', ru: 'Срок истёк' },
    },
    commandSemantics: {
      pause: 'claims',
      retry: 'linked-new-run',
      cleanupMinimumAgeSeconds: 2592000,
    },
  },
})
