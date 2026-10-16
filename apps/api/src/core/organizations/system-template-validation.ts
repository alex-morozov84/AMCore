import type { Prisma } from '../../generated/prisma/client.js'
import { ORG_DEFAULT_PERMISSIONS, ORG_DEFAULT_ROLE_GRANTS } from '../auth/casl/org-role-defaults.js'

export function templateSignature(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(templateSignature).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${templateSignature(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

type Template = Prisma.RoleGetPayload<{
  include: { permissions: { include: { permission: true } } }
}>

/** Read-only exact permission/link check also used by guarded seed. */
export function hasCanonicalTemplate(role: Template): boolean {
  const indexes = ORG_DEFAULT_ROLE_GRANTS[role.name as keyof typeof ORG_DEFAULT_ROLE_GRANTS]
  if (!role.isSystem || role.organizationId !== null || !indexes) return false
  if (role.permissions.length !== indexes.length) return false
  return indexes.every((index) => {
    const expected = ORG_DEFAULT_PERMISSIONS[index]!
    const actual = role.permissions.find((link) => link.permissionId === expected.id)?.permission
    return (
      actual?.organizationId === null &&
      templateSignature({
        id: actual.id,
        action: actual.action,
        subject: actual.subject,
        conditions: actual.conditions,
        fields: actual.fields,
        inverted: actual.inverted,
      }) === templateSignature(expected)
    )
  })
}
