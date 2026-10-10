export { createUuidV7 as createInvitationOperationId } from './uuid-v7'

export function invitationOperationTimestamp(id: string): number {
  return Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16)
}
