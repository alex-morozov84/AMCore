import type { MfaBrowserResult, MfaBrowserView } from '@amcore/shared'

import type { AccountMfaAdapter } from '@/features/account-mfa'
import { apiClient } from '@/shared/api/http-client'
import { getConsolePublicApiPath } from '@/shared/lib/console-public-api-path'

export function consoleMfaAdapter(scope: string): AccountMfaAdapter {
  const base = getConsolePublicApiPath('/auth/mfa')
  return {
    recoveryScope: scope,
    inspect: (operationId, flowBinding) =>
      apiClient.get<MfaBrowserView>(
        `${base}${operationId ? `?operationId=${encodeURIComponent(operationId)}` : ''}`,
        { headers: { 'x-amcore-mfa-flow': flowBinding ?? '' } }
      ),
    command: (command) => apiClient.post<MfaBrowserResult>(base, command),
    resolveStart: (operationId, purpose) =>
      apiClient.post<MfaBrowserResult>(`${base}/settings-start/status`, {
        action: 'status',
        operationId,
        purpose,
      }),
  }
}
