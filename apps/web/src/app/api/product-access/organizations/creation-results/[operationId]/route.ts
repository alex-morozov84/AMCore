import { organizationCreationHandlers } from '@/_app/organization-access/index.server'
import { contextMethodNotAllowed } from '@/shared/api/bff/context-route'

export async function GET(request: Request, context: { params: Promise<{ operationId: string }> }) {
  return organizationCreationHandlers.result(request, (await context.params).operationId)
}
export const HEAD = contextMethodNotAllowed
export const OPTIONS = contextMethodNotAllowed
export const POST = contextMethodNotAllowed
export const PUT = contextMethodNotAllowed
export const PATCH = contextMethodNotAllowed
export const DELETE = contextMethodNotAllowed
