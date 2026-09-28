import { subject } from '@casl/ability'

import { ForbiddenException } from '../../src/common/exceptions'
import type { AppAbility } from '../../src/core/auth/casl/ability.factory'
import { accessibleBy, createCaslExtension } from '../../src/core/auth/casl/prisma-ability'
import type { Prisma, Role } from '../../src/generated/prisma/client'
import type { PrismaService } from '../../src/prisma'

export const ROLE_SCALAR_FIELDS = [
  'id',
  'name',
  'description',
  'isSystem',
  'organizationId',
] as const
const operators = new Set(['equals', 'in', 'notIn', 'not', 'lt', 'lte', 'gt', 'gte'])

function validateCondition(value: unknown, fieldValue = false): void {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Unsupported recipe condition')
  for (const [key, item] of Object.entries(value)) {
    if (!fieldValue && ['AND', 'OR', 'NOT'].includes(key)) {
      const items = Array.isArray(item) ? item : [item]
      if (!items.length) throw new Error('Empty logical recipe condition')
      items.forEach((part) => validateCondition(part))
    } else if (
      !fieldValue &&
      ROLE_SCALAR_FIELDS.includes(key as (typeof ROLE_SCALAR_FIELDS)[number])
    ) {
      validateCondition(item, true)
    } else if (fieldValue && operators.has(key)) {
      if (key === 'in' || key === 'notIn') {
        if (!Array.isArray(item)) throw new Error('Invalid scalar membership')
        item.forEach((part) => validateCondition(part, true))
      } else validateCondition(item, true)
    } else throw new Error('Unsupported recipe operator or scalar')
  }
}

function assertAction(
  ability: AppAbility,
  action: string,
  row: Role,
  fields: readonly string[]
): void {
  const record = subject('Role', row)
  if (!ability.can(action, record) || fields.some((field) => !ability.can(action, record, field))) {
    throw new ForbiddenException('Role record or field permission denied')
  }
}

function project(ability: AppAbility, row: Role): Partial<Role> | null {
  const record = subject('Role', row)
  if (!ability.can('read', record) || !ability.can('read', record, 'id')) return null
  return Object.fromEntries(
    ROLE_SCALAR_FIELDS.filter((field) => ability.can('read', record, field)).map((field) => [
      field,
      row[field],
    ])
  )
}

/** Test/docs fixture only: uses the injected pool; actual team routes require TeamAccess. */
export function roleAuthorizationRecipe(
  prisma: PrismaService,
  ability: AppAbility,
  organizationId: string
): {
  list: () => Promise<Partial<Role>[]>
  count: () => Promise<number>
  read: (id: string) => Promise<Partial<Role>>
  update: (id: string, patch: Record<string, unknown>) => Promise<void>
  remove: (id: string) => Promise<void>
} {
  for (const rule of ability.rules) {
    const subjects = Array.isArray(rule.subject) ? rule.subject : [rule.subject]
    if (rule.conditions && subjects.some((name) => name === 'Role' || name === 'all'))
      validateCondition(rule.conditions)
  }
  const client = prisma.$extends(createCaslExtension())
  const where = (action: string): Prisma.RoleWhereInput => ({
    AND: [accessibleBy(ability, action).ofType('Role'), { organizationId }],
  })
  const lock = async (tx: Pick<typeof client, '$queryRaw' | 'role'>, id: string): Promise<Role> => {
    await tx.$queryRaw`SELECT id FROM core.roles WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`
    const row = await tx.role.findFirst({ where: { id, organizationId } })
    if (!row) throw new ForbiddenException('Role outside authorized tenant')
    return row
  }
  return {
    list: async (): Promise<Partial<Role>[]> => {
      const rows = await client.role.findMany({ where: where('read'), orderBy: { id: 'asc' } })
      return rows.map((row) => project(ability, row)).filter((row) => row !== null)
    },
    count: async (): Promise<number> => client.role.count({ where: where('read') }),
    read: async (id: string): Promise<Partial<Role>> => {
      const row = await client.role.findFirst({ where: { AND: [where('read'), { id }] } })
      const result = row ? project(ability, row) : null
      if (!result) throw new ForbiddenException('Role read denied')
      return result
    },
    update: async (id: string, patch: Record<string, unknown>): Promise<void> => {
      const fields = Object.keys(patch)
      if (
        fields.some((field) => !['name', 'description'].includes(field)) ||
        (patch.name !== undefined && typeof patch.name !== 'string') ||
        (patch.description !== undefined &&
          patch.description !== null &&
          typeof patch.description !== 'string')
      ) {
        throw new ForbiddenException('Immutable or invalid Role field')
      }
      await client.$transaction(async (tx) => {
        const row = await lock(tx, id)
        assertAction(ability, 'update', row, fields)
        // Role has no automatic timestamps or generated mutable scalars.
        assertAction(ability, 'update', { ...row, ...patch } as Role, fields)
        const changed = await tx.role.updateMany({
          where: { AND: [where('update'), { id }] },
          data: patch as Prisma.RoleUpdateManyMutationInput,
        })
        if (changed.count !== 1) throw new ForbiddenException('Role update predicate denied')
      })
    },
    remove: async (id: string): Promise<void> => {
      await client.$transaction(async (tx) => {
        const row = await lock(tx, id)
        assertAction(ability, 'delete', row, ROLE_SCALAR_FIELDS)
        const deleted = await tx.role.deleteMany({ where: { AND: [where('delete'), { id }] } })
        if (deleted.count !== 1) throw new ForbiddenException('Role delete predicate denied')
      })
    },
  }
}
