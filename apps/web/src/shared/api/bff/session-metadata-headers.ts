import { AMCORE_CLIENT_IP_HEADER } from '@amcore/shared'

import { resolveTrustedClientIp } from './trusted-client-ip'

import 'server-only'

/** Descriptive UA and explicitly verified visitor IP; never replay IP lookalikes. */
export function sessionMetadataHeaders(source: Headers): Record<string, string> {
  const visitorIp = resolveTrustedClientIp(source)
  return {
    'User-Agent': source.get('user-agent') ?? '',
    ...(visitorIp ? { [AMCORE_CLIENT_IP_HEADER]: visitorIp } : {}),
  }
}
