import { Action, Subject } from '../enums/permissions'

export interface CapabilityDescriptor<TSubject extends string = Subject> {
  id: string
  subject: TSubject
  action: Action
  operation: string
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: `/${string}`
  credentials: readonly ('bearer' | 'apiKey')[]
  labelKey: string
  presets: readonly string[]
  editableFields: readonly string[]
}

/** Code-declared implemented operations; registration never grants authority. */
export const CAPABILITY_CATALOGUE = [
  {
    id: 'teamAccess.manage',
    subject: Subject.TeamAccess,
    action: Action.Manage,
    operation: 'roles.list',
    method: 'GET',
    path: '/organizations/:orgId/roles',
    credentials: ['bearer', 'apiKey'] as const,
    labelKey: 'teamAccessManagement',
    presets: ['all'] as const,
    editableFields: [] as const,
  },
  {
    id: 'organization.read',
    subject: Subject.Organization,
    action: Action.Read,
    operation: 'organizations.findOne',
    method: 'GET',
    path: '/organizations/:id',
    credentials: ['bearer', 'apiKey'] as const,
    labelKey: 'organizationRead',
    presets: ['own', 'all'] as const,
    editableFields: [] as const,
  },
  {
    id: 'organization.update',
    subject: Subject.Organization,
    action: Action.Update,
    operation: 'organizations.update',
    method: 'PATCH',
    path: '/organizations/:id',
    credentials: ['bearer', 'apiKey'] as const,
    labelKey: 'organizationUpdate',
    presets: ['own', 'all'] as const,
    editableFields: ['name', 'slug'] as const,
  },
  {
    id: 'organization.delete',
    subject: Subject.Organization,
    action: Action.Delete,
    operation: 'organizations.remove',
    method: 'DELETE',
    path: '/organizations/:id',
    credentials: ['bearer', 'apiKey'] as const,
    labelKey: 'organizationDelete',
    presets: ['own', 'all'] as const,
    editableFields: [] as const,
  },
] as const satisfies readonly CapabilityDescriptor[]

export type CapabilityId = (typeof CAPABILITY_CATALOGUE)[number]['id']
export type CapabilityPresetId = (typeof CAPABILITY_CATALOGUE)[number]['presets'][number]
