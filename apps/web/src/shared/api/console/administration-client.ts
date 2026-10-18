import {
  administratorAssignmentReceiptSchema,
  administratorAttentionSchema,
  administratorCommandReceiptSchema,
  administratorOperationSchema,
  administratorSummarySchema,
} from '@amcore/shared'

import { getConsolePublicApiPath } from '@/shared/lib/console-public-api-path'

import { readConsoleOrganization, writeConsoleOrganization } from './provisioning-client'

import 'client-only'

const root = (id: string) =>
  getConsolePublicApiPath(`/organizations/${encodeURIComponent(id)}/administration`)
export const administrationClient = {
  attention: (binding: string, page: number, signal: AbortSignal) =>
    readConsoleOrganization(
      `${getConsolePublicApiPath('/organizations/attention')}?page=${page}`,
      binding,
      administratorAttentionSchema,
      signal
    ),
  summary: (
    binding: string,
    id: string,
    adminPage: number,
    invitationPage: number,
    signal: AbortSignal
  ) =>
    readConsoleOrganization(
      `${root(id)}?adminPage=${adminPage}&invitationPage=${invitationPage}`,
      binding,
      administratorSummarySchema,
      signal
    ),
  command: (binding: string, id: string, path: string, input: unknown, signal: AbortSignal) =>
    writeConsoleOrganization(
      `${root(id)}/${path}`,
      binding,
      input,
      path === 'assign'
        ? administratorAssignmentReceiptSchema.or(administratorCommandReceiptSchema)
        : administratorCommandReceiptSchema,
      signal
    ),
  lookup: (binding: string, id: string, operationId: string, signal: AbortSignal) =>
    readConsoleOrganization(
      `${root(id)}/operations/${operationId}`,
      binding,
      administratorOperationSchema,
      signal
    ),
}
