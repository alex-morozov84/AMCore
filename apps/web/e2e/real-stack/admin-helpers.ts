import { randomUUID } from 'node:crypto'

import { guardedSql } from '../support/managed-target.mjs'

export function setSystemRole(email: string, role: 'USER' | 'SUPER_ADMIN'): void {
  const output = guardedSql(
    `UPDATE core.users SET "systemRole" = :'role' WHERE "emailCanonical" = :'email';`,
    {
      email,
      role,
    }
  )
  if (output.trim() !== 'UPDATE 1') {
    throw new Error(`Expected exactly one registered user for role setup; got ${output.trim()}`)
  }
}
export function countAuditViews(email: string): number {
  return Number(
    guardedSql(
      `SELECT count(*) FROM core.audit_log a JOIN core.users u ON u.id = a."actorId" WHERE u."emailCanonical" = :'email' AND a.action = 'admin.audit_logs.viewed';`,
      { email }
    ).trim()
  )
}
export function getUserId(email: string): string {
  return guardedSql(`SELECT id FROM core.users WHERE "emailCanonical" = :'email';`, {
    email,
  }).trim()
}
export function createAuditProbe(email: string, marker: string, ageMinutes: number): void {
  guardedSql(
    `INSERT INTO core.audit_log (id, "createdAt", "actorType", "actorId", action, category, metadata) SELECT :'marker', now() - (:'age'::int * interval '1 minute'), 'USER', id, 'admin.cleanup.executed', 'SECURITY', '{}'::jsonb FROM core.users WHERE "emailCanonical" = :'email';`,
    { email, marker, age: ageMinutes }
  )
}
// A live access token can outlast its deleted backend session; count DB rows to
// prove revocation rather than assuming an immediate redirect in the browser.
export function countLiveSessions(email: string): number {
  return Number(
    guardedSql(
      `SELECT count(*) FROM core.sessions s JOIN core.users u ON u.id = s."userId" WHERE u."emailCanonical" = :'email' AND s."revokedAt" IS NULL;`,
      { email }
    ).trim()
  )
}
export function ageSessionLastAuthAt(email: string): void {
  guardedSql(
    `UPDATE core.sessions SET "lastAuthAt" = now() - interval '20 minutes' WHERE "userId" = (SELECT id FROM core.users WHERE "emailCanonical" = :'email') AND "revokedAt" IS NULL;`,
    { email }
  )
}
export function createOrganization(name: string, slug: string, createdAt?: Date): void {
  guardedSql(
    `INSERT INTO core.organizations (id, name, slug, "createdAt", "updatedAt") VALUES (:'id', :'name', :'slug', coalesce(nullif(:'created', '')::timestamptz, now()), now());`,
    { id: randomUUID(), name, slug, created: createdAt?.toISOString() ?? '' }
  )
}
export function createOrganizationsForPagination(marker: number): void {
  const records = [
    {
      id: randomUUID(),
      name: `Page2 Marker Org ${marker}`,
      slug: `pagination-marker-${marker}`,
      age: 0,
    },
    ...Array.from({ length: 20 }, (_, i) => ({
      id: randomUUID(),
      name: `Pagination Filler ${marker}-${i}`,
      slug: `pagination-filler-${marker}-${i}`,
      age: i + 1,
    })),
  ]
  guardedSql(
    `INSERT INTO core.organizations (id, name, slug, "createdAt", "updatedAt") SELECT id, name, slug, now() + (age * interval '1 second'), now() FROM jsonb_to_recordset(:'records'::jsonb) AS r(id text, name text, slug text, age int);`,
    { records: JSON.stringify(records) }
  )
}
export function createNamedUser(email: string, name: string, createdAt: Date): void {
  guardedSql(
    `INSERT INTO core.users (id, email, "emailCanonical", name, "createdAt", "updatedAt") VALUES (:'id', :'email', :'email', :'name', :'created'::timestamptz, now());`,
    { id: randomUUID(), email, name, created: createdAt.toISOString() }
  )
}
// One admitted batch; future rows keep the marker on page two deterministically.
export function createUsersForPagination(markerEmail: string, fillerPrefix: string): void {
  const records = [
    { id: randomUUID(), email: markerEmail, age: 0 },
    ...Array.from({ length: 20 }, (_, i) => ({
      id: randomUUID(),
      email: `${fillerPrefix}-${i}@e2e.amcore.test`,
      age: i + 1,
    })),
  ]
  guardedSql(
    `INSERT INTO core.users (id, email, "emailCanonical", "createdAt", "updatedAt") SELECT id, email, email, now() + (age * interval '1 second'), now() FROM jsonb_to_recordset(:'records'::jsonb) AS r(id text, email text, age int);`,
    { records: JSON.stringify(records) }
  )
}
