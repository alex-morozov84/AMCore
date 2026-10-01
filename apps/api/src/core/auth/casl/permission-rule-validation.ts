import { HttpStatus } from '@nestjs/common'

import { Action, PermissionErrorCode, Subject, SystemRole } from '@amcore/shared'

import { AppException } from '../../../common/exceptions'

import { isEpochMilliseconds, normalizeDateConditions } from './normalize-date-conditions'
import {
  isModelSubject,
  MODEL_FIELDS,
  MODEL_SUBJECTS,
  type ModelSubject,
  type ScalarKind,
} from './permission-model-fields'
import { prismaQuery } from './prisma-ability'

type Code = `${PermissionErrorCode}`
export interface PermissionWriteInput {
  action: Action
  subject: Subject
  conditions?: Record<string, unknown> | null
  fields?: string[]
  inverted?: boolean
}
const fail = (code: Code): never => {
  throw new AppException('Unsupported permission rule', HttpStatus.BAD_REQUEST, code)
}

const OPERATORS = new Set([
  'not',
  'in',
  'notIn',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'startsWith',
  'endsWith',
])
const LOGIC = new Set(['AND', 'OR', 'NOT'])
const MAX_DEPTH = 4
const MAX_TERMS = 64

function substitute(
  value: unknown,
  kind: ScalarKind,
  subject: ModelSubject,
  field: string
): unknown {
  if (typeof value !== 'string' || !value.includes('${')) return value
  if (value === '${user.sub}' || value === '${user.organizationId}') {
    if (kind !== 'string' && kind !== 'nullableString')
      fail(PermissionErrorCode.PERMISSION_PLACEHOLDER_UNSUPPORTED)
    const identity = value === '${user.sub}'
    const validField = identity
      ? (subject === Subject.User && field === 'id') ||
        field === 'assignedToId' ||
        field === 'ownerId'
      : (subject === Subject.Organization && field === 'id') || field === 'organizationId'
    if (!validField) fail(PermissionErrorCode.PERMISSION_PLACEHOLDER_UNSUPPORTED)
    return value === '${user.sub}' ? 'user-id' : 'organization-id'
  }
  return fail(PermissionErrorCode.PERMISSION_PLACEHOLDER_UNSUPPORTED)
}

function scalar(value: unknown, kind: ScalarKind, subject: ModelSubject, field: string): unknown {
  const resolved = substitute(value, kind, subject, field)
  if (resolved === null && (kind === 'nullableString' || kind === 'nullableDate')) return null
  if ((kind === 'date' || kind === 'nullableDate') && isEpochMilliseconds(resolved)) return resolved
  if (
    kind === 'integer' &&
    typeof resolved === 'number' &&
    Number.isInteger(resolved) &&
    resolved >= 0 &&
    resolved <= 2_147_483_647
  )
    return resolved
  if (kind === 'boolean' && typeof resolved === 'boolean') return resolved
  if ((kind === 'string' || kind === 'nullableString') && typeof resolved === 'string') {
    if (
      subject === Subject.User &&
      field === 'systemRole' &&
      !Object.values(SystemRole).includes(resolved as SystemRole)
    )
      fail('PERMISSION_RULE_UNSUPPORTED')
    if (
      subject === Subject.Permission &&
      field === 'action' &&
      !Object.values(Action).includes(resolved as Action)
    )
      fail('PERMISSION_RULE_UNSUPPORTED')
    if (
      subject === Subject.Permission &&
      field === 'subject' &&
      !Object.values(Subject).includes(resolved as Subject)
    )
      fail('PERMISSION_RULE_UNSUPPORTED')
    return resolved
  }
  return fail('PERMISSION_RULE_UNSUPPORTED')
}

function predicate(
  value: unknown,
  kind: ScalarKind,
  subject: ModelSubject,
  field: string
): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return scalar(value, kind, subject, field)
  const entries = Object.entries(value)
  if (!entries.length) fail('PERMISSION_RULE_UNSUPPORTED')
  return Object.fromEntries(
    entries.map(([operator, operand]) => {
      if (!OPERATORS.has(operator)) fail('PERMISSION_RULE_UNSUPPORTED')
      if (operator === 'in' || operator === 'notIn') {
        if (!Array.isArray(operand) || !operand.length || operand.length > MAX_TERMS)
          fail('PERMISSION_RULE_UNSUPPORTED')
        return [operator, operand.map((item: unknown) => scalar(item, kind, subject, field))]
      }
      if (
        ['contains', 'startsWith', 'endsWith'].includes(operator) &&
        kind !== 'string' &&
        kind !== 'nullableString'
      )
        fail('PERMISSION_RULE_UNSUPPORTED')
      if (
        ['gt', 'gte', 'lt', 'lte'].includes(operator) &&
        ((kind !== 'integer' && kind !== 'date' && kind !== 'nullableDate') || operand === null)
      )
        fail('PERMISSION_RULE_UNSUPPORTED')
      return [operator, scalar(operand, kind, subject, field)]
    })
  )
}

function condition(
  input: Record<string, unknown>,
  subject: ModelSubject,
  depth = 0,
  budget = { remaining: MAX_TERMS }
): Record<string, unknown> {
  if (depth > MAX_DEPTH || --budget.remaining < 0) fail('PERMISSION_RULE_UNSUPPORTED')
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (LOGIC.has(key)) {
        if (Array.isArray(value)) {
          if (!value.length) fail('PERMISSION_RULE_UNSUPPORTED')
          return [key, value.map((item) => logicalChild(item, subject, depth, budget))]
        }
        if (key !== 'NOT') fail('PERMISSION_RULE_UNSUPPORTED')
        return [key, logicalChild(value, subject, depth, budget)]
      }
      const kind = MODEL_FIELDS[subject][key]
      if (!kind) fail('PERMISSION_RULE_UNSUPPORTED')
      return [key, predicate(value, kind!, subject, key)]
    })
  )
}

function logicalChild(
  value: unknown,
  subject: ModelSubject,
  depth: number,
  budget: { remaining: number }
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length)
    fail('PERMISSION_RULE_UNSUPPORTED')
  return condition(value as Record<string, unknown>, subject, depth + 1, budget)
}

export function validatePermissionRule(dto: PermissionWriteInput): void {
  if (dto.subject === Subject.TeamAccess) {
    if (
      dto.action !== Action.Manage ||
      (dto.conditions && Object.keys(dto.conditions).length > 0) ||
      (dto.fields?.length && (dto.fields.length !== 1 || dto.fields[0] !== '*'))
    )
      fail('PERMISSION_RULE_UNSUPPORTED')
    return
  }
  if (dto.subject === Subject.All && !dto.inverted) fail('PERMISSION_RULE_UNSUPPORTED')
  const subjects = dto.subject === Subject.All ? MODEL_SUBJECTS : [dto.subject]
  if (!subjects.every(isModelSubject)) fail('PERMISSION_RULE_UNSUPPORTED')
  const fields = dto.fields ?? []
  if (
    new Set(fields).size !== fields.length ||
    (fields.includes('*') && fields.length !== 1) ||
    fields.some(
      (field) =>
        field !== '*' &&
        subjects.some((subject) => !Object.hasOwn(MODEL_FIELDS[subject as ModelSubject], field))
    )
  )
    fail('PERMISSION_FIELD_UNSUPPORTED')
  if (dto.conditions == null) return
  for (const subject of subjects as ModelSubject[]) {
    const checked = condition(dto.conditions, subject)
    try {
      if (Object.keys(checked).length) prismaQuery(normalizeDateConditions(checked, subject)).ast
    } catch {
      fail('PERMISSION_RULE_UNSUPPORTED')
    }
  }
}
