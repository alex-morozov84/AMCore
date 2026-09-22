import type { AdminUserResponse, SystemRole } from '@amcore/shared'

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
  updateUserRole: (userId: string, systemRole: SystemRole): Promise<AdminUserResponse> =>
    apiClient.patch<AdminUserResponse>(getConsolePublicApiPath(`/users/${userId}/role`), {
      systemRole,
    }),

  /** `POST /auth/step-up` never returns its token to this client — the BFF
   * handler discards it and responds `204` on success (see
   * `shared/api/console/step-up.ts`). */
  stepUp: (password: string): Promise<void> =>
    apiClient.post<void>(getConsolePublicApiPath('/auth/step-up'), { password }),
}
