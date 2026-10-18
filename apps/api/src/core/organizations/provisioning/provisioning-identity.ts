import { createHash } from 'node:crypto'

import { invitationOperationTimestamp, type ProvisioningCreate } from '@amcore/shared'

import type { OrganizationProvisioning, Prisma } from '../../../generated/prisma/client.js'
import { acquireXactLock } from '../../../prisma/advisory-lock.js'
import { invitationClock } from '../invitation-locks.js'

import { provisioningError } from './provisioning-error.js'

export function provisioningFingerprint(input: ProvisioningCreate): string {
  return hashProvisioningIntent({
    version: 1,
    name: input.name.trim(),
    slug: input.slug ?? null,
    email: input.firstAdminEmail,
    locale: input.inviteLocale,
    role: 'ADMIN',
  })
}
export function hashProvisioningIntent(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}
export async function lockProvisioningCreation(
  tx: Prisma.TransactionClient,
  operationId: string
): Promise<void> {
  await acquireXactLock(tx, `organization-provisioning:${operationId}`)
}
export async function provisioningAge(
  tx: Prisma.TransactionClient,
  operationId: string
): Promise<number> {
  return (await invitationClock(tx)).getTime() - invitationOperationTimestamp(operationId)
}
export function assertFreshProvisioningId(age: number): void {
  if (age > 86_400_000 || age < -300_000) throw provisioningError('PROVISIONING_OPERATION_EXPIRED')
}
export function provisioningReceipt(row: OrganizationProvisioning): {
  operationId: string
  organizationId: string
  createdAt: string
} {
  return {
    operationId: row.operationId,
    organizationId: row.organizationId,
    createdAt: row.createdAt.toISOString(),
  }
}
