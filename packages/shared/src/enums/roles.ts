/**
 * SystemRole - const-as-type pattern
 *
 * Intentionally NOT a TypeScript enum. Using const-as-type so that the
 * type ('USER' | 'SUPER_ADMIN') is structurally identical to what Prisma
 * generates — enabling direct assignment with zero runtime casts.
 *
 * Usage:
 *   SystemRole.User      → 'USER'
 *   SystemRole.SuperAdmin → 'SUPER_ADMIN'
 *   type SystemRole       → 'USER' | 'SUPER_ADMIN'
 */
export const SystemRole = {
  User: 'USER',
  SuperAdmin: 'SUPER_ADMIN',
} as const

export type SystemRole = (typeof SystemRole)[keyof typeof SystemRole]
