import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'

import { AuthType, CAPABILITY_CATALOGUE, type CapabilityId } from '@amcore/shared'

import { ORG_READ_FIELDS } from '../auth/casl/org-role-defaults'
import { ADR_034_APIKEY_ALLOWLIST } from '../auth/decorators/adr-034-api-key-allowlist'
import { AUTH_TYPE_KEY } from '../auth/decorators/auth.decorator'
import { TEAM_ACCESS_KEY } from '../auth/decorators/require-team-access.decorator'
import { REQUEST_CONTEXT_POLICY } from '../auth/organization-context/request-context-policy'

import { CapabilitiesController } from './capabilities.controller'
import { CAPABILITY_ADAPTERS } from './capability-registry.service'
import { OrganizationsController } from './organizations.controller'
import { PresetPermissionsController } from './preset-permissions.controller'
import { RolesController } from './roles.controller'

type Binding = { controller: object; handler: string }
const bindings = {
  'teamAccess.manage': { controller: RolesController, handler: 'listRoles' },
  'organization.read': { controller: OrganizationsController, handler: 'findOne' },
  'organization.update': { controller: OrganizationsController, handler: 'update' },
  'organization.delete': { controller: OrganizationsController, handler: 'remove' },
} satisfies Record<CapabilityId, Binding>

function route(cls: object, name: string) {
  const handler = (cls as { prototype: Record<string, unknown> }).prototype[name]!
  const classPath = Reflect.getMetadata(PATH_METADATA, cls) as string
  const handlerPath = ((Reflect.getMetadata(PATH_METADATA, handler) ?? '') as string).replace(
    /^\/+|\/+$/g,
    ''
  )
  const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod
  const auth = (Reflect.getMetadata(AUTH_TYPE_KEY, handler) ??
    Reflect.getMetadata(AUTH_TYPE_KEY, cls)) as AuthType[]
  return {
    handler,
    classPath,
    handlerPath,
    path: `/${[classPath, handlerPath].filter(Boolean).join('/')}`
      .replace(/\/+$/g, '')
      .replace(/\/+/g, '/'),
    method,
    auth,
  }
}

describe('published capability route parity', () => {
  it('requires one real handler binding and matching admission policy per catalogue entry', () => {
    expect(Object.keys(bindings).sort()).toEqual(CAPABILITY_CATALOGUE.map((item) => item.id).sort())
    expect(Object.keys(CAPABILITY_ADAPTERS).sort()).toEqual(Object.keys(bindings).sort())
    for (const descriptor of CAPABILITY_CATALOGUE) {
      const binding = bindings[descriptor.id]
      const adapter = CAPABILITY_ADAPTERS[descriptor.id]
      const actual = route(binding.controller, binding.handler)
      expect(adapter.operation).toBe(descriptor.operation)
      expect([adapter.path, actual.path]).toEqual([descriptor.path, descriptor.path])
      expect([adapter.method, RequestMethod[actual.method]]).toEqual([
        descriptor.method,
        descriptor.method,
      ])
      expect(adapter.credentials).toEqual(descriptor.credentials)
      expect(adapter.editableFields).toEqual(descriptor.editableFields)
      expect(actual.auth).toEqual([AuthType.Bearer, AuthType.ApiKey])
      expect(adapter.tenantBound).toBe(true)
      expect(Reflect.getOwnMetadata(TEAM_ACCESS_KEY, actual.handler)).toBe(
        adapter.teamAccess ? (adapter.selector ?? 'id') : undefined
      )
      expect(Reflect.getOwnMetadata(REQUEST_CONTEXT_POLICY, actual.handler)).toMatchObject(
        adapter.context === 'discovery'
          ? { kind: 'discovery' }
          : { kind: 'organization', selector: { param: adapter.selector } }
      )
      expect(ADR_034_APIKEY_ALLOWLIST).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: actual.method,
            classPath: actual.classPath,
            handlerPath: actual.handlerPath,
          }),
        ])
      )
      expect(adapter.requiredReadFields).toEqual(
        descriptor.subject === 'Organization' ? ORG_READ_FIELDS : []
      )
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
