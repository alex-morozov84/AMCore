import { Subject } from '@amcore/shared'

export type ModelSubject = Subject.User | Subject.Organization | Subject.Role | Subject.Permission
export type ScalarKind =
  'string' | 'nullableString' | 'boolean' | 'integer' | 'date' | 'nullableDate'

export const MODEL_FIELDS: Record<ModelSubject, Record<string, ScalarKind>> = {
  [Subject.User]: {
    id: 'string',
    email: 'string',
    emailVerified: 'boolean',
    name: 'nullableString',
    // Derived from the stored avatarKey: the permission names the attribute the API returns.
    avatarUrl: 'nullableString',
    phone: 'nullableString',
    locale: 'string',
    timezone: 'string',
    createdAt: 'date',
    updatedAt: 'date',
    lastLoginAt: 'nullableDate',
    systemRole: 'string',
  },
  [Subject.Organization]: {
    id: 'string',
    name: 'string',
    slug: 'string',
    aclVersion: 'integer',
    createdAt: 'date',
    updatedAt: 'date',
  },
  [Subject.Role]: {
    id: 'string',
    name: 'string',
    description: 'nullableString',
    isSystem: 'boolean',
    organizationId: 'nullableString',
  },
  [Subject.Permission]: {
    id: 'string',
    action: 'string',
    subject: 'string',
    inverted: 'boolean',
    organizationId: 'nullableString',
  },
}

export const MODEL_SUBJECTS = Object.keys(MODEL_FIELDS) as ModelSubject[]

export const isModelSubject = (subject: string): subject is ModelSubject =>
  Object.hasOwn(MODEL_FIELDS, subject)

/**
 * Response attributes that appear in the permission vocabulary but are not stored columns.
 * They may be listed in a rule's `fields` (the API returns them) and are refused in its
 * `conditions` (the record has no such column, so a condition could never be evaluated).
 * `avatarUrl` is computed from the stored `avatarKey`; keeping the response name here leaves the
 * installed default permission rows exact.
 */
export const DERIVED_FIELDS: Partial<Record<ModelSubject, readonly string[]>> = {
  [Subject.User]: ['avatarUrl'],
}

export const isDerivedField = (subject: ModelSubject, field: string): boolean =>
  DERIVED_FIELDS[subject]?.includes(field) ?? false
