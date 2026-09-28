import { Action, Subject } from '@amcore/shared'

export const ORG_READ_FIELDS = ['id', 'name', 'slug', 'aclVersion', 'createdAt', 'updatedAt']
export const OWN_USER_READ_FIELDS = [
  'id',
  'email',
  'emailVerified',
  'name',
  'avatarUrl',
  'phone',
  'locale',
  'timezone',
  'createdAt',
  'lastLoginAt',
]
export const OWN_USER_UPDATE_FIELDS = ['name', 'locale', 'timezone']

const ownUser = { id: '${user.sub}' }
const ownOrg = { id: '${user.organizationId}' }
export const ORG_DEFAULT_PERMISSIONS = [
  {
    id: 'org-default-v2-read-org',
    action: Action.Read,
    subject: Subject.Organization,
    conditions: ownOrg,
    fields: ORG_READ_FIELDS,
    inverted: false,
  },
  {
    id: 'org-default-v2-read-self',
    action: Action.Read,
    subject: Subject.User,
    conditions: ownUser,
    fields: OWN_USER_READ_FIELDS,
    inverted: false,
  },
  {
    id: 'org-default-v2-update-self',
    action: Action.Update,
    subject: Subject.User,
    conditions: ownUser,
    fields: OWN_USER_UPDATE_FIELDS,
    inverted: false,
  },
  {
    id: 'org-default-v2-update-org',
    action: Action.Update,
    subject: Subject.Organization,
    conditions: ownOrg,
    fields: ['name', 'slug'],
    inverted: false,
  },
  {
    id: 'org-default-v2-delete-org',
    action: Action.Delete,
    subject: Subject.Organization,
    conditions: ownOrg,
    fields: [],
    inverted: false,
  },
  {
    id: 'org-default-v2-team-access',
    action: Action.Manage,
    subject: Subject.TeamAccess,
    conditions: null,
    fields: [],
    inverted: false,
  },
]
export const ORG_DEFAULT_ROLE_GRANTS = {
  VIEWER: [0, 1],
  MEMBER: [0, 1, 2],
  ADMIN: [0, 1, 2, 3, 4, 5],
}
