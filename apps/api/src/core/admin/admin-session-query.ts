import type { AdminSessionsQuery } from '@amcore/shared'

import type { PrismaService } from '../../prisma'

export interface SessionListRow {
  familyId: string
  userAgent: string | null
  ipAddress: string | null
  lastAuthAt: string | null
  createdAt: string
  expiresAt: string
}

/** One SQL snapshot: deduplicate before paging/counting, without reading token columns. */
export async function querySessionPage(
  prisma: PrismaService,
  userId: string,
  query: AdminSessionsQuery
): Promise<{ rows: SessionListRow[]; total: number }> {
  const skip = (query.page - 1) * query.limit
  const [result] = await prisma.$queryRaw<Array<{ rows: SessionListRow[]; total: number }>>`
    WITH active AS (
      SELECT DISTINCT ON ("familyId")
        "familyId", "userAgent", "ipAddress",
        "lastAuthAt" AT TIME ZONE 'UTC' AS "lastAuthAt",
        "createdAt" AT TIME ZONE 'UTC' AS "createdAt",
        "expiresAt" AT TIME ZONE 'UTC' AS "expiresAt"
      FROM core.sessions
      WHERE "userId" = ${userId} AND "revokedAt" IS NULL AND "expiresAt" > (NOW() AT TIME ZONE 'UTC')
      ORDER BY "familyId", "createdAt" DESC, id DESC
    ), page AS (
      SELECT * FROM active ORDER BY "createdAt" DESC, "familyId" ASC
      LIMIT ${query.limit} OFFSET ${skip}
    )
    SELECT COALESCE((SELECT jsonb_agg(page ORDER BY "createdAt" DESC, "familyId" ASC) FROM page), '[]'::jsonb) AS rows,
      (SELECT count(*)::int FROM active) AS total
  `
  if (!result) throw new Error('Session page aggregate returned no row')
  return result
}
