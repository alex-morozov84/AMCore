import { apiErrorResponse } from './api-error-response'
import { authFailureResponse } from './auth-failure-response'
import { ContextRequestError } from './context-errors'

import 'server-only'

export async function contextRoute(
  request: Request,
  work: () => Promise<unknown>
): Promise<Response> {
  try {
    return Response.json(await work(), { headers: { 'cache-control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof ContextRequestError) {
      const response = apiErrorResponse(request, {
        statusCode: error.status,
        errorCode: error.errorCode,
        message: 'Organization context request failed',
      })
      response.headers.set('cache-control', 'private, no-store')
      return response
    }
    const response = authFailureResponse(request, error)
    response.headers.set('cache-control', 'private, no-store')
    return response
  }
}

export function contextMethodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'GET' } })
}
