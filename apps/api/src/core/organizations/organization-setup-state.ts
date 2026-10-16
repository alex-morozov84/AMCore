import type { OrganizationSetupStatus } from '@amcore/shared'

import { canonicalAdmin } from './canonical-admin'
import { establishmentError } from './establishment-error'
import {
  INITIAL_ORGANIZATION_KEY,
  readEstablishmentResult,
  setupCompletion,
} from './establishment-result'

import type { Prisma } from '@/generated/prisma/client'

/** Read classifier uses one joined completion snapshot and never locks existing parents. */
export async function readSetupState(
  tx: Prisma.TransactionClient,
  creationEnabled: boolean
): Promise<OrganizationSetupStatus> {
  const schema = await setupSchema(tx)
  if (!schema.bootstrap) return { state: 'not-ready', reason: 'schema-unavailable' }
  const receipt = await readEstablishmentResult(tx, 'bootstrap')
  if (receipt) return setupCompletion(receipt)
  return emptySetupState(tx, creationEnabled, schema.creation)
}

/** Called under setup/table locks, before target/child locks. Receipt means leave this branch. */
export async function mutationSetupState(
  tx: Prisma.TransactionClient,
  creationEnabled: boolean
): Promise<'completed' | OrganizationSetupStatus> {
  const schema = await setupSchema(tx)
  if (!schema.bootstrap) return { state: 'not-ready', reason: 'schema-unavailable' }
  if (await tx.organizationBootstrapResult.findUnique({ where: { key: INITIAL_ORGANIZATION_KEY } }))
    return 'completed'
  return emptySetupState(tx, creationEnabled, schema.creation)
}

async function setupSchema(
  tx: Prisma.TransactionClient
): Promise<{ bootstrap: boolean; creation: boolean }> {
  const [row] = await tx.$queryRaw<{ bootstrap: boolean; creation: boolean }[]>`
    SELECT to_regclass('core.organization_bootstrap_results') IS NOT NULL AS bootstrap,
      to_regclass('core.organization_creation_results') IS NOT NULL AS creation`
  return row ?? { bootstrap: false, creation: false }
}

async function emptySetupState(
  tx: Prisma.TransactionClient,
  creationEnabled: boolean,
  schemaReady: boolean
): Promise<OrganizationSetupStatus> {
  if (await tx.organization.findFirst({ select: { id: true } }))
    return { state: 'existing-org-without-receipt' }
  if (!schemaReady) return { state: 'not-ready', reason: 'schema-unavailable' }
  if (creationEnabled) return { state: 'not-ready', reason: 'creation-enabled' }
  try {
    await canonicalAdmin(tx)
  } catch (error) {
    if (
      error instanceof Error &&
      'errorCode' in error &&
      error.errorCode === 'SYSTEM_NOT_INITIALIZED'
    )
      return { state: 'not-ready', reason: 'templates-unavailable' }
    throw error
  }
  return { state: 'eligible-empty' }
}

export function assertSetupEligible(state: 'completed' | OrganizationSetupStatus): void {
  if (state === 'completed' || state.state !== 'eligible-empty') {
    throw establishmentError(
      state !== 'completed' && state.state === 'not-ready' ? 'SETUP_NOT_READY' : 'SETUP_CLOSED'
    )
  }
}
