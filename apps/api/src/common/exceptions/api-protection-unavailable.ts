import { ApiResponse } from '@nestjs/swagger'

/**
 * Documents the fail-closed 503 that an abuse counter answers when it cannot be read or
 * recorded (Redis down, over its deadline, or an unexpected stored value). The response
 * carries errorCode `SERVICE_UNAVAILABLE`; clients may retry later.
 */
export const ApiProtectionUnavailable = (subject: 'API key' | 'invitation'): MethodDecorator =>
  ApiResponse({
    status: 503,
    description:
      subject === 'API key'
        ? 'SERVICE_UNAVAILABLE: the API key failure counters could not be checked, so the request is refused. Sent only when an API key is presented. Retry later.'
        : 'SERVICE_UNAVAILABLE: the invitation failure counters could not be checked, so the request is refused before any invitation work. Retry later.',
  })
