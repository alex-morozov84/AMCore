import { parseStructuralModel } from './path-algebra-ast-model.mjs'
import {
  routeReferenceInventory,
  weakRootAssertionCount,
} from './project-locale-e2e-route-inventory.mjs'
import {
  E2E_ROUTE_SURFACES,
  OAUTH_E2E_ROUTE_SURFACE,
} from './project-locale-e2e-route-surfaces.mjs'

export function e2eRouteResiduals(contents) {
  const residuals = []
  for (const [pathname] of [...E2E_ROUTE_SURFACES, OAUTH_E2E_ROUTE_SURFACE]) {
    const content = contents.get(pathname)
    if (content === undefined) {
      residuals.push(`${pathname}:missing projected verification surface`)
      continue
    }
    const model = parseStructuralModel(pathname, content)
    const inventory = routeReferenceInventory(model)
    if (inventory.count) residuals.push(`${pathname}:${inventory.count} locale-prefixed routes`)
    if (weakRootAssertionCount(model)) residuals.push(`${pathname}:inexact root URL assertion`)
    if (content.includes('name: /language/i') && content.includes("selectOption('ru')")) {
      residuals.push(`${pathname}:locale-switcher scenario`)
    }
  }
  return residuals
}
