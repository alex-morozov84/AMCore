import { validateOwnership } from './ownership-validate.mjs'
import {
  ROUTE_PROGRESS_OPERATION_KEY,
  ROUTE_PROGRESS_SOURCE_PATH,
  routeProgressOwnership,
} from './project-route-progress-ownership.mjs'

export function buildRouteProgressFacts(root, state) {
  if (!state.selected.routeProgress) return []
  validateOwnership(root, routeProgressOwnership)
  return [
    {
      kind: 'content',
      dimension: 'route-progress',
      path: ROUTE_PROGRESS_SOURCE_PATH,
      operationKey: ROUTE_PROGRESS_OPERATION_KEY,
      params: { enabled: false },
    },
  ]
}
