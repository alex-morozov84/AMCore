import { type BrowserAudience, browserContextViewSchema } from '@amcore/shared'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'
import { parseRetryAfterSeconds } from '../retry-after'

import {
  changedBrowserContext,
  privateBrowserHeaders,
  readBrowserAnchor,
  unavailableBrowserContext,
} from './browser-binding.server'
import { ContextRequestError } from './context-errors'

import 'server-only'

/** An inert cookie is anonymous only after the primary confirms an account-neutral browser revision. */
export async function requireNeutralBrowserContext(
  source: Headers,
  audience: BrowserAudience
): Promise<void> {
  const binding = readBrowserAnchor(source, audience)
  if (!binding) throw changedBrowserContext()
  const response = await fetchBackendResponse(
    `${getBackendBaseUrl()}/api/v1/auth/browser-publications/status`,
    source,
    {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: { ...privateBrowserHeaders(audience), 'content-type': 'application/json' },
      body: JSON.stringify({ binding }),
    }
  ).catch(() => {
    throw unavailableBrowserContext()
  })
  if (response.status === 429)
    throw new ContextRequestError(
      429,
      'RATE_LIMIT_EXCEEDED',
      parseRetryAfterSeconds(response.headers)
    )
  if ([401, 403, 409].includes(response.status)) throw changedBrowserContext()
  if (!response.ok) throw unavailableBrowserContext()
  const view = browserContextViewSchema.safeParse(await response.json().catch(() => null))
  if (!view.success) throw unavailableBrowserContext()
  if (!['empty', 'logged_out'].includes(view.data.state)) throw changedBrowserContext()
}
