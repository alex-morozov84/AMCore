import { NotificationPreparationError } from '../../../src/core/notifications/channels/notification-prepared-request'
import type { NotificationPreparedRequestService } from '../../../src/core/notifications/dispatch/notification-prepared-request.service'

/** Adapter-only tests bypass persistence. PostgreSQL contract suites prove snapshot CAS separately. */
export function preparationDouble(): NotificationPreparedRequestService {
  return {
    async obtain(...args: Parameters<NotificationPreparedRequestService['obtain']>) {
      try {
        return await args[5]()
      } catch (error) {
        if (error instanceof NotificationPreparationError) {
          return { status: 'permanent', errorCode: error.code }
        }
        throw error
      }
    },
  } as NotificationPreparedRequestService
}
