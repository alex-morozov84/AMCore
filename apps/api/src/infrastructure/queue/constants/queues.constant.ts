/**
 * Queue Names
 *
 * Centralized queue name definitions.
 * Add new queues here as the application grows.
 */
export enum QueueName {
  /**
   * Email queue for sending transactional emails
   */
  EMAIL = 'email',

  /**
   * Default queue for miscellaneous async tasks
   */
  DEFAULT = 'default',

  /**
   * Notifications dispatch wake queue (ADR-052). Carries one-attempt `DISPATCH_DUE`
   * wake jobs that nudge the worker to drain due deliveries; Postgres owns the retry
   * schedule, so this queue is never a retry owner.
   */
  NOTIFICATIONS = 'notifications',

  /**
   * AI durable-run wake queue (Track C — ADR-054, ADR-052 pattern). Carries one-attempt
   * `AI_RUN_WAKE` jobs that nudge the worker to claim due runs; Postgres owns the run
   * lease/retry schedule, so this queue is never a retry owner. The worker executor +
   * recovery cron arrive in Arc C.4 — C.1 only enqueues the wake.
   */
  AI_RUNS = 'ai-runs',
}

/**
 * Queue Job Names
 *
 * Specific job types within queues
 */
export enum JobName {
  // Email jobs
  SEND_EMAIL = 'send-email',

  // Notification dispatch wake (ADR-052): "due deliveries exist, drain the batch".
  DISPATCH_DUE = 'dispatch-due',

  // AI run wake (ADR-054): "a queued run exists, claim the batch". Worker-drained in Arc C.4.
  AI_RUN_WAKE = 'ai-run-wake',
}
