import { MEMBER_REQUEST_BYTES } from '@amcore/shared'

import { contextRouteBody } from './context-route-input'

import 'server-only'

export { contextRouteInput as memberRouteInput, contextRouteQuery as memberRouteQuery } from './context-route-input'
export function memberRouteBody(request: Request) {
  return contextRouteBody(request, MEMBER_REQUEST_BYTES)
}
export function memberMethodNotAllowed() {
  return new Response(null, { status: 405, headers: { Allow: 'GET, PATCH' } })
}
