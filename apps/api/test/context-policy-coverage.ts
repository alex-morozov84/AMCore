import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'

import type { OrganizationContextFamily } from '@amcore/shared'

import {
  ORGANIZATION_BOUNDARY,
  REQUEST_CONTEXT_POLICY,
  REQUEST_CONTEXT_POLICY_COUNT,
} from '../src/core/auth/organization-context/request-context-policy'

function paths(value: string | string[] | undefined): string[] {
  return Array.isArray(value) ? value : [value ?? '']
}

/** Test-only scoped coverage. Unmarked API modules deliberately remain outside this guarantee. */
export function scopedContextRoutes(controllers: Function[]): string[] {
  const routes: string[] = []
  for (const controller of controllers) {
    const family = Reflect.getMetadata(ORGANIZATION_BOUNDARY, controller) as
      OrganizationContextFamily | undefined
    for (const name of Object.getOwnPropertyNames(controller.prototype ?? {})) {
      const handler = Object.getOwnPropertyDescriptor(controller.prototype, name)?.value
      if (
        typeof handler !== 'function' ||
        Reflect.getMetadata(METHOD_METADATA, handler) === undefined
      )
        continue
      const policy = Reflect.getOwnMetadata(REQUEST_CONTEXT_POLICY, handler)
      if (!family && !policy) continue
      if (
        !family ||
        !policy ||
        Reflect.getOwnMetadata(REQUEST_CONTEXT_POLICY_COUNT, handler) !== 1
      ) {
        throw new Error(`Missing/conflicting context boundary/policy: ${controller.name}.${name}`)
      }
      for (const prefix of paths(Reflect.getMetadata(PATH_METADATA, controller))) {
        for (const suffix of paths(Reflect.getMetadata(PATH_METADATA, handler))) {
          const path = `/api/v1/${prefix}/${suffix}`.replace(/\/+/g, '/').replace(/\/$/, '')
          if (
            policy.kind === 'organization' &&
            !family.apiRoots.some((root) => path === root || path.startsWith(`${root}/`))
          ) {
            throw new Error(`Uncovered declared organization route: ${path}`)
          }
          if (family.apiRoots.length > 0) routes.push(path)
        }
      }
    }
  }
  return routes
}

export function assertFamiliesCloseRoutes(
  routes: string[],
  families: readonly OrganizationContextFamily[]
): void {
  for (const path of routes) {
    if (
      !families.some(({ apiRoots }) =>
        apiRoots.some((root) => path === root || path.startsWith(`${root}/`))
      )
    ) {
      throw new Error(`Generic organization family omitted: ${path}`)
    }
  }
}
