import { readOrganizationBootstrap } from '@/entities/organization-context/index.server'
import { contextMethodNotAllowed, contextRoute } from '@/shared/api/bff/context-route'

export function GET(request: Request): Promise<Response> {
  return contextRoute(request, () => readOrganizationBootstrap(request.headers, request.signal))
}

export const HEAD = contextMethodNotAllowed
export const OPTIONS = contextMethodNotAllowed
export const POST = contextMethodNotAllowed
export const PUT = contextMethodNotAllowed
export const PATCH = contextMethodNotAllowed
export const DELETE = contextMethodNotAllowed
