import type { WorkFailureReasons } from '@amcore/shared'

/** Static operator vocabulary. Unknown/custom provider text never becomes a diagnostic. */
export const notificationWorkFailures: WorkFailureReasons = {
  telegram_rate_limited: {
    title: { en: 'Telegram rate limit', ru: 'Ограничение частоты Telegram' },
    nextStep: {
      en: 'Keep the provider delay. Retry only when the safe grant is available.',
      ru: 'Сохраните задержку провайдера. Повторите только при доступном безопасном праве.',
    },
  },
  telegram_blocked: {
    title: { en: 'Telegram destination blocked', ru: 'Получатель Telegram заблокирован' },
  },
  telegram_chat_not_found: {
    title: { en: 'Telegram chat unavailable', ru: 'Чат Telegram недоступен' },
  },
  telegram_migrated: {
    title: { en: 'Telegram chat generation changed', ru: 'Поколение чата Telegram изменилось' },
  },
  telegram_provider_permanent: {
    title: { en: 'Permanent Telegram refusal', ru: 'Постоянный отказ Telegram' },
  },
  telegram_provider_transient: {
    title: { en: 'Temporary Telegram failure', ru: 'Временная ошибка Telegram' },
  },
  email_provider_permanent: {
    title: { en: 'Permanent email-provider refusal', ru: 'Постоянный отказ почтового провайдера' },
  },
  email_provider_transient: {
    title: { en: 'Temporary email-provider failure', ru: 'Временная ошибка почтового провайдера' },
  },
  provider_timeout: {
    title: {
      en: 'Provider timeout; effect uncertain',
      ru: 'Провайдер не ответил; результат неизвестен',
    },
  },
  provider_error: {
    title: {
      en: 'Provider call failed; effect uncertain',
      ru: 'Вызов провайдера завершился ошибкой; результат неизвестен',
    },
  },
  lease_expired: { title: { en: 'Attempt lease expired', ru: 'Срок аренды попытки истёк' } },
  notification_version_unavailable: {
    title: {
      en: 'Stored notification version unavailable',
      ru: 'Сохранённая версия уведомления недоступна',
    },
  },
  notification_prepared_request_invalid: {
    title: { en: 'Stored request incompatible', ru: 'Сохранённый запрос несовместим' },
  },
  legacy_delivery_outcome_unverified: {
    title: {
      en: 'Historical delivery outcome unverified',
      ru: 'Результат прежней доставки не подтверждён',
    },
  },
  notification_channel_unavailable: {
    title: { en: 'Notification channel unavailable', ru: 'Канал уведомлений недоступен' },
  },
  delivery_cancelled: { title: { en: 'Delivery cancelled', ru: 'Доставка отменена' } },
}
