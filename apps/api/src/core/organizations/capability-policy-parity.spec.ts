import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'

import { AuthType, CAPABILITY_CATALOGUE } from '@amcore/shared'

import { AUTH_TYPE_KEY } from '../auth/decorators/auth.decorator'
import { TEAM_ACCESS_KEY } from '../auth/decorators/require-team-access.decorator'
import { REQUEST_CONTEXT_POLICY } from '../auth/organization-context/request-context-policy'

import { CapabilitiesController } from './capabilities.controller'
import { OrganizationsController } from './organizations.controller'
import { PresetPermissionsController } from './preset-permissions.controller'
import { RolesController } from './roles.controller'

const routes = [
  ['teamAccess.manage', RolesController, 'listRoles', true],
  ['organization.read', OrganizationsController, 'findOne', false],
  ['organization.update', OrganizationsController, 'update', false],
  ['organization.delete', OrganizationsController, 'remove', true],
] as const

function route(cls: object, name: string) {
  const handler = (cls as { prototype: Record<string, unknown> }).prototype[name]!
  const root = Reflect.getMetadata(PATH_METADATA, cls) as string
  const leaf = Reflect.getMetadata(PATH_METADATA, handler) as string
  const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod
  const auth = (Reflect.getMetadata(AUTH_TYPE_KEY, handler) ??
    Reflect.getMetadata(AUTH_TYPE_KEY, cls)) as AuthType[]
  return {
    handler,
    path: `/${[root, leaf].filter(Boolean).join('/')}`.replace(/\/+$/g, '').replace(/\/+/g, '/'),
    method: RequestMethod[method],
    auth,
  }
}

describe('published capability route parity', () => {
  it('matches each descriptor to its concrete handler, credential and guard policy', () => {
    for (const [id, controller, handler, team] of routes) {
      const descriptor = CAPABILITY_CATALOGUE.find((entry) => entry.id === id)!
      const actual = route(controller, handler)
      expect(actual.path).toBe(descriptor.path)
      expect(actual.method).toBe(descriptor.method)
      expect(actual.auth).toEqual([AuthType.Bearer, AuthType.ApiKey])
      expect(
        Reflect.getMetadata(TEAM_ACCESS_KEY, actual.handler) ===
          (descriptor.path.includes(':orgId') ? 'orgId' : 'id')
      ).toBe(team)
      expect(Reflect.getMetadata(REQUEST_CONTEXT_POLICY, actual.handler)).toBeDefined()
    }
  })

  it('keeps discovery and preset writes bearer-only with method-level org policy', () => {
    for (const [controller, handler] of [
      [CapabilitiesController, 'catalogue'],
      [PresetPermissionsController, 'assign'],
    ] as const) {
      const actual = route(controller, handler)
      expect(actual.auth).toEqual([AuthType.Bearer])
      expect(Reflect.getOwnMetadata(TEAM_ACCESS_KEY, actual.handler)).toBe('orgId')
      expect(Reflect.getOwnMetadata(REQUEST_CONTEXT_POLICY, actual.handler)).toMatchObject({
        kind: 'organization',
        selector: { param: 'orgId' },
      })
    }
  })
})
