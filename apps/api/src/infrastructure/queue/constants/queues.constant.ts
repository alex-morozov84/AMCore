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
}

/**
 * Queue Job Names
 *
 * Specific job types within queues
 */
export enum JobName {
  // Email jobs
  SEND_EMAIL = 'send-email',
  SEND_BULK_EMAIL = 'send-bulk-email',

  // Example jobs
  HELLO_WORLD = 'hello-world',
}
