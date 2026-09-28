import type { PrismaQueryOf } from '@casl/prisma/runtime'

import type { Prisma } from '@/generated/prisma/client'

export type { Subjects } from '@casl/prisma/runtime'
export {
  accessibleBy,
  createCaslExtension,
  createPrismaAbility,
  ParsingQueryError,
  prismaQuery,
} from '@casl/prisma/runtime'
export type PrismaQuery = PrismaQueryOf<Prisma.TypeMap>
