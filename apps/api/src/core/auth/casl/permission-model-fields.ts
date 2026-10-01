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
