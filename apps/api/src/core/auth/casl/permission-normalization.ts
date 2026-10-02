import { Action, type RequestPrincipal, Subject } from '@amcore/shared'

import { interpolateConditions } from './interpolate-conditions'
import { normalizeDateConditions } from './normalize-date-conditions'
import { isModelSubject } from './permission-model-fields'
import { type PermissionWriteInput, validatePermissionRule } from './permission-rule-validation'
import { prismaQuery } from './prisma-ability'

export interface AbilityPermission {
  id: string
  action: string
  subject: string
  conditions: unknown
  fields: string[]
  inverted: boolean
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => compare(a, b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function assertJson(value: unknown): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (Array.isArray(value)) {
    value.forEach(assertJson)
    return
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    Object.values(value).forEach(assertJson)
    return
  }
  throw new Error('Stored conditions must contain JSON values')
}

function validate(permission: AbilityPermission, synthetic: boolean): void {
  const valid =
    typeof permission.id === 'string' &&
    permission.id.length > 0 &&
    Object.values(Action).includes(permission.action as Action) &&
    Object.values(Subject).includes(permission.subject as Subject) &&
    typeof permission.inverted === 'boolean' &&
    Array.isArray(permission.fields) &&
    permission.fields.every((field) => typeof field === 'string') &&
    (permission.conditions === null ||
      (typeof permission.conditions === 'object' &&
        !Array.isArray(permission.conditions) &&
        permission.conditions !== null &&
        Object.getPrototypeOf(permission.conditions) === Object.prototype))
  if (!valid) throw new Error('Invalid stored authorization rule')
  assertJson(permission.conditions)
  if (!synthetic && permission.subject === Subject.All && !permission.inverted) {
    throw new Error('Positive wildcard organization grants are unsupported')
  }
  if (
    permission.subject === Subject.TeamAccess &&
    (permission.action !== Action.Manage ||
      (permission.conditions !== null && Object.keys(permission.conditions as object).length > 0) ||
      (permission.fields.length > 0 && canonical(permission.fields) !== '["*"]'))
  )
    throw new Error('TeamAccess must be an unrestricted manage rule')
}

/** Validate and eagerly parse the entire owner payload before any narrowing. */
export function normalizeOwnerPermissions(
  permissions: AbilityPermission[],
  principal: RequestPrincipal,
  synthetic = false
): AbilityPermission[] {
  const identities = new Map<string, string>()
  const result: AbilityPermission[] = []
  for (const permission of permissions) {
    validate(permission, synthetic)
    if (!(synthetic && permission.subject === Subject.All && !permission.inverted)) {
      try {
        validatePermissionRule(permission as unknown as PermissionWriteInput)
      } catch {
        throw new Error('Stored authorization rule incompatible')
      }
    }
    const signature = canonical(permission)
    const previous = identities.get(permission.id)
    if (previous !== undefined && previous !== signature)
      throw new Error('Conflicting permission ID')
    if (previous !== undefined) continue
    identities.set(permission.id, signature)
    const interpolated =
      permission.conditions === null
        ? null
        : interpolateConditions(permission.conditions as Record<string, unknown>, principal)
    const conditions =
      interpolated && isModelSubject(permission.subject)
        ? normalizeDateConditions(interpolated, permission.subject)
        : interpolated
    if (conditions && Object.keys(conditions).length) prismaQuery(conditions).ast
    result.push({ ...permission, conditions, fields: [...permission.fields] })
  }
  return sortPermissions(result)
}

export function sortPermissions(permissions: AbilityPermission[]): AbilityPermission[] {
  return [...permissions].sort(
    (a, b) =>
      Number(a.inverted) - Number(b.inverted) ||
      compare(a.id, b.id) ||
      compare(a.action, b.action) ||
      compare(a.subject, b.subject)
  )
}

export function narrowPermissions(
  permissions: AbilityPermission[],
  scopes?: string[]
): AbilityPermission[] {
  if (!scopes) return sortPermissions(permissions)
  const result = new Map<string, AbilityPermission>()
  const canonicalScopes = [...new Set(scopes)].sort(compare)
  for (const permission of permissions) {
    for (const scope of canonicalScopes) {
      const parts = scope.split(':')
      const [action, subject] = parts
      if (
        parts.length !== 2 ||
        !action ||
        !subject ||
        !Object.values(Action).includes(action as Action) ||
        !Object.values(Subject).includes(subject as Subject) ||
        (action === Action.Manage && subject === Subject.All)
      )
        continue
      const narrowedAction = intersect(permission.action, action, Action.Manage)
      const narrowedSubject = intersect(permission.subject, subject, Subject.All)
      if (!narrowedAction || !narrowedSubject) continue
      const narrowed = { ...permission, action: narrowedAction, subject: narrowedSubject }
      result.set(canonical([permission.id, narrowedAction, narrowedSubject]), narrowed)
    }
  }
  return sortPermissions([...result.values()])
}

function intersect(a: string, b: string, top: string): string | null {
  return a === b || b === top ? a : a === top ? b : null
}

export function hasFullTeamAccess(permissions: AbilityPermission[]): boolean {
  const veto = new Set<string>([
    Subject.TeamAccess,
    Subject.Role,
    Subject.Permission,
    Subject.User,
    Subject.All,
  ])
  return (
    permissions.some(
      (rule) =>
        !rule.inverted && rule.action === Action.Manage && rule.subject === Subject.TeamAccess
    ) && !permissions.some((rule) => rule.inverted && veto.has(rule.subject))
  )
}
