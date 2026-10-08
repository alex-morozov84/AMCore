import { ROLE_REQUEST_BYTES } from '@amcore/shared'

import { contextRouteBody } from './context-route-input'

import 'server-only'

export {
  contextRouteInput as roleRouteInput,
  contextRouteQuery as roleRouteQuery,
} from './context-route-input'

/** Strict JSON body of a role-definition command: Origin-checked, no query, no encoding, 16 KiB. */
export function roleRouteBody(request: Request) {
  return contextRouteBody(request, ROLE_REQUEST_BYTES)
}

/** Explicit 405 with the allowed methods; there is no implicit HEAD/OPTIONS fall-through. */
export function roleMethodDenied(allow: string) {
  return () => new Response(null, { status: 405, headers: { Allow: allow } })
}
