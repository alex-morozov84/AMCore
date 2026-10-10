import type {
  AdminApiKeyRevokeResponse,
  AdminQueuesResponse,
  AdminSessionsListResponse,
  AdminUserResponse,
  StorageProbeSettingResponse,
  StorageProbeSettingUpdate,
  SupportedLocale,
  SystemRole,
  WorkCommand,
  WorkJob,
  WorkListQuery,
  WorkPage,
  WorkReceipt,
  WorkReconciliation,
  WorkSummary,
} from '@amcore/shared'

import { getConsolePublicApiPath } from '@/shared/lib/console-public-api-path'

import { apiClient } from './http-client'

/**
 * Client-safe Operations Console mutations — unlike `shared/api/console/**`
 * (server-only, holds real credentials), this module only ever calls this
 * app's own same-origin `/api/*` Route Handlers (ADR-068), the same way
 * `authApi` does for the product. Every path goes through
 * `getConsolePublicApiPath()` so it resolves correctly in both topologies.
 */
export const consoleApi = {
  getBackgroundWork: (signal?: AbortSignal): Promise<WorkSummary[]> =>
    apiClient.get(getConsolePublicApiPath('/background-work/works'), { signal }),
  getBackgroundWorkJobs: (
    workId: string,
    query: WorkListQuery,
    signal?: AbortSignal
  ): Promise<WorkPage> =>
    apiClient.get(
      getConsolePublicApiPath(
        `/background-work/works/${encodeURIComponent(workId)}/jobs?${new URLSearchParams(
          Object.entries(query).map(([key, value]) => [key, String(value)])
        )}`
      ),
      { signal }
    ),
  getBackgroundWorkJob: (workId: string, jobId: string, signal?: AbortSignal): Promise<WorkJob> =>
    apiClient.get(
      getConsolePublicApiPath(
        `/background-work/works/${encodeURIComponent(workId)}/jobs/${encodeURIComponent(jobId)}`
      ),
      { signal }
    ),
  requestBackgroundWorkCommand: (input: WorkCommand): Promise<WorkReceipt> =>
    apiClient.post(getConsolePublicApiPath('/background-work/commands'), input),
  getBackgroundWorkReceipt: (commandId: string, signal?: AbortSignal): Promise<WorkReceipt> =>
    apiClient.get(
      getConsolePublicApiPath(`/background-work/commands/${encodeURIComponent(commandId)}`),
      { signal }
    ),
  reconcileBackgroundWorkCommand: (
    commandId: string,
    input: WorkReconciliation
  ): Promise<WorkReceipt> =>
    apiClient.post(
      getConsolePublicApiPath(
        `/background-work/commands/${encodeURIComponent(commandId)}/reconciliation`
      ),
      input
    ),
  reconcileBackgroundWorkEvidence: (
    workId: string,
    jobId: string,
    input: WorkReconciliation
  ): Promise<void> =>
    apiClient.post(
      getConsolePublicApiPath(
        `/background-work/works/${encodeURIComponent(workId)}/jobs/${encodeURIComponent(jobId)}/reconciliation`
      ),
      input
    ),
  /** Live refresh of Background work; the signal cancels the browser request on unmount. */
  getBackgroundWorkQueues: (signal?: AbortSignal): Promise<AdminQueuesResponse> =>
    apiClient.get(getConsolePublicApiPath('/background-work/queues'), { signal }),
  getStorageProbeSetting: (): Promise<StorageProbeSettingResponse> =>
    apiClient.get(getConsolePublicApiPath('/runtime-settings/storage-probe')),
  updateStorageProbeSetting: (
    input: StorageProbeSettingUpdate
  ): Promise<StorageProbeSettingResponse> =>
    apiClient.patch(getConsolePublicApiPath('/runtime-settings/storage-probe'), input),
  revokeApiKey: (id: string): Promise<AdminApiKeyRevokeResponse> =>
    apiClient.delete<AdminApiKeyRevokeResponse>(
      getConsolePublicApiPath(`/api-keys/${encodeURIComponent(id)}`)
    ),
  revokeSelectedApiKeys: (ids: string[]): Promise<AdminApiKeyRevokeResponse> =>
    apiClient.post<AdminApiKeyRevokeResponse>(getConsolePublicApiPath('/api-keys/revoke'), { ids }),
  updateUserRole: (userId: string, systemRole: SystemRole): Promise<AdminUserResponse> =>
    apiClient.patch<AdminUserResponse>(getConsolePublicApiPath(`/users/${userId}/role`), {
      systemRole,
    }),

  /** `POST /auth/step-up` never returns its token to this client — the BFF
   * handler discards it and responds `204` on success (see
   * `shared/api/console/step-up.ts`). */
  stepUp: (password: string): Promise<void> =>
    apiClient.post<void>(getConsolePublicApiPath('/auth/step-up'), { password }),

  // `locale` is sent explicitly as `Accept-Language` for the same reason as
  // `authApi.getSessions` — the BFF route isn't under `[locale]`.
  getUserSessions: (
    userId: string,
    page: number,
    limit: number,
    locale: SupportedLocale
  ): Promise<AdminSessionsListResponse> =>
    apiClient.get<AdminSessionsListResponse>(
      getConsolePublicApiPath(`/users/${userId}/sessions?page=${page}&limit=${limit}`),
      { headers: { 'Accept-Language': locale } }
    ),

  revokeUserSession: (userId: string, sessionId: string): Promise<void> =>
    apiClient.delete<void>(
      getConsolePublicApiPath(`/users/${userId}/sessions/${encodeURIComponent(sessionId)}`)
    ),

  revokeAllUserSessions: (userId: string): Promise<void> =>
    apiClient.delete<void>(getConsolePublicApiPath(`/users/${userId}/sessions`)),
}
