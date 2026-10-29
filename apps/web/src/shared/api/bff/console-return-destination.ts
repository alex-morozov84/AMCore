import { getConsoleOverviewHref } from '@/shared/lib/console-public-href'

import type { BrowserAuthPublication } from './browser-auth-attempt'
import { changedBrowserContext } from './browser-binding.server'
import { callLogoutReceipt, canonicalConsoleReturn, loadReturnEntry } from './console-return-entry'
import type { ProductWebContext } from './product-web-context.server'
import type { VaultEntry } from './session-vault.types'

import 'server-only'

export async function confirmedConsoleReturn(
  request: Request,
  context: ProductWebContext,
  record: BrowserAuthPublication,
  entry: VaultEntry
) {
  const navigation = record.consoleEntry
  if (!navigation) return undefined
  const fallback = { href: getConsoleOverviewHref(), locale: navigation.locale }
  if (!navigation.proof) return fallback
  const retained = await loadReturnEntry(request, context, navigation.proof.returnEntryId).catch(
    () => null
  )
  if (!retained) return fallback
  const outcome = await callLogoutReceipt(request, context, retained, 'logout-result').catch(
    () => null
  )
  if (outcome?.state === 'superseded') throw changedBrowserContext()
  if (
    !outcome ||
    outcome.state !== 'published' ||
    outcome.neutralAttemptId !== record.id ||
    outcome.familyId !== entry.browser?.familyId ||
    outcome.completionId !== record.completionId ||
    outcome.reservedGeneration !== record.browser.generation ||
    retained.userId !== entry.userSnapshot.id
  )
    return fallback
  return { href: canonicalConsoleReturn(retained.destination), locale: retained.locale }
}
