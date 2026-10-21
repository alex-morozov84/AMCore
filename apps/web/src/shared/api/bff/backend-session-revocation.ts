import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'

/** Revokes a server-held backend refresh session without exposing it to the browser. */
export async function revokeBackendSession(refreshToken: string): Promise<void> {
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/logout`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      headers: { Cookie: `refresh_token=${refreshToken}` },
    })
    if (!response.ok) console.error(`[bff] backend logout returned status ${response.status}`)
  } catch {
    console.error('[bff] backend logout failed', { category: 'transport' })
  }
}
