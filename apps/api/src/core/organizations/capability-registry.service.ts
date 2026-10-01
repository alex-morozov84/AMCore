import { subject } from '@casl/ability'
import { HttpStatus, Injectable } from '@nestjs/common'

import {
  Action,
  type ActorAffordances,
  type AssignPermissionInput,
  CAPABILITY_CATALOGUE,
  type CapabilityCatalogueResponse,
  type CapabilityId,
  type CreatePresetPermissionInput,
  type OrganizationRecordAffordances,
  PermissionErrorCode,
  Subject,
} from '@amcore/shared'

import { AppException } from '../../common/exceptions'
import type { AppAbility, TeamAccessDecision } from '../auth/casl/ability.factory'
import { ORG_READ_FIELDS } from '../auth/casl/org-role-defaults'

import type { Organization } from '@/generated/prisma/client'

interface CapabilityAdapter {
  operation: string
  method: 'GET' | 'PATCH' | 'DELETE'
  path: `/${string}`
  context: 'discovery' | 'organization'
  selector?: 'id' | 'orgId'
  teamAccess: boolean
  tenantBound: boolean
  requiredReadFields: readonly string[]
  subject: Subject
  action: Action
  credentials: readonly ('bearer' | 'apiKey')[]
  presets: readonly string[]
  editableFields: readonly string[]
  preset: (id: string) => AssignPermissionInput
}

const organizationPreset = (
  action: Action,
  fields: string[],
  id: string
): AssignPermissionInput => ({
  action,
  subject: Subject.Organization,
  conditions: id === 'own' ? { id: '${user.organizationId}' } : null,
  fields,
  inverted: false,
})

export const CAPABILITY_ADAPTERS: Record<CapabilityId, CapabilityAdapter> = {
  'teamAccess.manage': {
    operation: 'roles.list',
    method: 'GET',
    path: '/organizations/:orgId/roles',
    context: 'organization',
    selector: 'orgId',
    teamAccess: true,
    tenantBound: true,
    requiredReadFields: [],
    subject: Subject.TeamAccess,
    action: Action.Manage,
    credentials: ['bearer', 'apiKey'],
    presets: ['all'],
    editableFields: [],
    preset: () => ({
      action: Action.Manage,
      subject: Subject.TeamAccess,
      conditions: null,
      fields: [],
      inverted: false,
    }),
  },
  'organization.read': {
    operation: 'organizations.findOne',
    method: 'GET',
    path: '/organizations/:id',
    context: 'discovery',
    teamAccess: false,
    tenantBound: true,
    requiredReadFields: ORG_READ_FIELDS,
    subject: Subject.Organization,
    action: Action.Read,
    credentials: ['bearer', 'apiKey'],
    presets: ['own', 'all'],
    editableFields: [],
    preset: (id) => organizationPreset(Action.Read, [], id),
  },
  'organization.update': {
    operation: 'organizations.update',
    method: 'PATCH',
    path: '/organizations/:id',
    context: 'organization',
    selector: 'id',
    teamAccess: false,
    tenantBound: true,
    requiredReadFields: ORG_READ_FIELDS,
    subject: Subject.Organization,
    action: Action.Update,
    credentials: ['bearer', 'apiKey'],
    presets: ['own', 'all'],
    editableFields: ['name', 'slug'],
    preset: (id) => organizationPreset(Action.Update, ['name', 'slug'], id),
  },
  'organization.delete': {
    operation: 'organizations.remove',
    method: 'DELETE',
    path: '/organizations/:id',
    context: 'organization',
    selector: 'id',
    teamAccess: true,
    tenantBound: true,
    requiredReadFields: ORG_READ_FIELDS,
    subject: Subject.Organization,
    action: Action.Delete,
    credentials: ['bearer', 'apiKey'],
    presets: ['own', 'all'],
    editableFields: [],
    preset: (id) => organizationPreset(Action.Delete, [], id),
  },
}
const error = (): never => {
  throw new AppException(
    'Unsupported capability or preset',
    HttpStatus.BAD_REQUEST,
    PermissionErrorCode.CAPABILITY_UNSUPPORTED
  )
}

type Rule = AppAbility['rules'][number]
const unconditional = (rule: Rule): boolean =>
  !rule.conditions || Object.keys(rule.conditions).length === 0
const relevant = (rule: Rule, action: Action, field: string): boolean =>
  (rule.subject === Subject.Organization || rule.subject === Subject.All) &&
  (rule.action === action || rule.action === Action.Manage) &&
  (!rule.fields?.length || rule.fields.includes('*') || rule.fields.includes(field))

function fieldPossibility(
  ability: AppAbility,
  action: Action,
  field: string
): { possible: boolean; unconditional: boolean } {
  const rules = ability.rules.filter((rule) => relevant(rule, action, field))
  const allows = rules.filter((rule) => !rule.inverted)
  const denies = rules.filter((rule) => rule.inverted)
  return {
    possible: allows.length > 0 && !denies.some(unconditional),
    unconditional: allows.some(unconditional) && denies.length === 0,
  }
}

function classify(
  ability: AppAbility,
  action: Action,
  fields: readonly string[]
): ActorAffordances[keyof ActorAffordances] {
  const checks = fields.map((field) => fieldPossibility(ability, action, field))
  if (checks.some((check) => !check.possible)) return 'denied'
  if (checks.every((check) => check.unconditional)) return 'allowed'
  return 'recordRequired'
}

@Injectable()
export class CapabilityRegistry {
  constructor() {
    const ids = CAPABILITY_CATALOGUE.map((entry) => entry.id)
    if (
      ids.length !== new Set(ids).size ||
      ids.length !== Object.keys(CAPABILITY_ADAPTERS).length ||
      CAPABILITY_CATALOGUE.some((entry) => {
        const adapter = CAPABILITY_ADAPTERS[entry.id]
        return (
          !adapter ||
          adapter.operation !== entry.operation ||
          adapter.method !== entry.method ||
          adapter.path !== entry.path ||
          adapter.subject !== entry.subject ||
          adapter.action !== entry.action ||
          JSON.stringify(adapter.credentials) !== JSON.stringify(entry.credentials) ||
          JSON.stringify(adapter.presets) !== JSON.stringify(entry.presets) ||
          JSON.stringify(adapter.editableFields) !== JSON.stringify(entry.editableFields)
        )
      })
    )
      throw new Error('Capability adapter coverage mismatch')
  }

  catalogue(): CapabilityCatalogueResponse {
    return {
      capabilities: CAPABILITY_CATALOGUE.map((entry) => ({
        ...entry,
        credentials: [...entry.credentials],
        presets: [...entry.presets],
        editableFields: [...entry.editableFields],
      })),
    }
  }

  preset(input: CreatePresetPermissionInput): AssignPermissionInput {
    const adapter = CAPABILITY_ADAPTERS[input.capabilityId]
    if (!adapter || !adapter.presets.includes(input.presetId)) return error()
    return adapter.preset(input.presetId)
  }

  actor(ability: AppAbility, access: TeamAccessDecision): ActorAffordances {
    const team = access.ownerTrusted && access.credentialTrusted
    const read = classify(ability, Action.Read, ORG_READ_FIELDS)
    const updateFields = ['name', 'slug'].map((field) =>
      fieldPossibility(ability, Action.Update, field)
    )
    const update =
      read === 'denied' || updateFields.every((field) => !field.possible)
        ? 'denied'
        : read === 'allowed' && updateFields.some((field) => field.unconditional)
          ? 'allowed'
          : 'recordRequired'
    return {
      'teamAccess.manage': team ? 'allowed' : 'denied',
      'organization.read': 'allowed', // verified membership on this bearer-only context
      'organization.update': update,
      'organization.delete': team ? classify(ability, Action.Delete, ORG_READ_FIELDS) : 'denied',
    }
  }

  record(
    ability: AppAbility,
    access: TeamAccessDecision,
    org: Organization
  ): OrganizationRecordAffordances {
    const row = subject('Organization', org)
    const readable =
      ability.can(Action.Read, row) &&
      ORG_READ_FIELDS.every((field) => ability.can(Action.Read, row, field))
    const fields = {
      name: readable && ability.can(Action.Update, row) && ability.can(Action.Update, row, 'name'),
      slug: readable && ability.can(Action.Update, row) && ability.can(Action.Update, row, 'slug'),
    }
    const deletable =
      access.ownerTrusted &&
      access.credentialTrusted &&
      ability.can(Action.Delete, row) &&
      ORG_READ_FIELDS.every((field) => ability.can(Action.Delete, row, field))
    return {
      'organization.read': {
        allowed: true,
        fields: Object.fromEntries(ORG_READ_FIELDS.map((field) => [field, true])),
      },
      'organization.update': { allowed: fields.name || fields.slug, fields },
      'organization.delete': { allowed: deletable, fields: {} },
    }
  }
}
