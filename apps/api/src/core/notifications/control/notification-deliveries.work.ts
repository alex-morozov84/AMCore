import { notificationWorkFailures } from './notification-work-failures'

import { defineDurableWork } from '@/infrastructure/background-work'

export const notificationDeliveriesWork = defineDurableWork({
  id: 'notification-deliveries',
  definitionVersion: 1,
  failureReasons: notificationWorkFailures,
  presentation: {
    name: { en: 'Notification deliveries', ru: 'Доставки уведомлений' },
    fields: {
      channel: { en: 'Channel', ru: 'Канал' },
      target: { en: 'Original destination', ru: 'Исходный получатель' },
      generation: { en: 'Connection generation', ru: 'Поколение подключения' },
      reference: { en: 'Notification ID', ru: 'Идентификатор уведомления' },
      unresolved: {
        en: 'Unconfirmed sending attempts',
        ru: 'Есть отправки без подтверждённого результата',
      },
    },
    attemptHistory: true,
    technicalFields: ['reference', 'generation'],
    nativeStates: {
      PENDING: { en: 'Pending', ru: 'Ожидает обработки' },
      PROCESSING: { en: 'Processing', ru: 'В обработке' },
      RETRY_SCHEDULED: { en: 'Retry scheduled', ru: 'Повтор запланирован' },
      DELIVERED: { en: 'Delivery accepted', ru: 'Доставка принята' },
      FAILED: { en: 'Failed', ru: 'Ошибка' },
      SKIPPED: { en: 'Skipped', ru: 'Пропущена' },
      CANCELLED: { en: 'Cancelled', ru: 'Отменена' },
    },
    commandSemantics: {
      pause: 'claims',
      retry: 'scheduled-single-grant',
      cleanupMinimumAgeSeconds: 2592000,
    },
  },
})
