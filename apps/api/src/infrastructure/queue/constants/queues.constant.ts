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
}
