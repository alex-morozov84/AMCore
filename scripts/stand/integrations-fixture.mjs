import { sql } from './ownership.mjs'
import { save } from './state.mjs'

/**
 * Managed preview data for the Console Integrations screen. The screen's only action sends a test
 * email to the operator's own VERIFIED address, and a fresh stand registers its demo accounts
 * unverified. This marks the demo SUPER_ADMIN address verified, a demo-only mailbox substitute (a
 * stand sends no real mail). A repeat run changes nothing.
 */
export async function integrationsFixture(m) {
  const record = (m.integrationsFixture ??= { version: 1 })
  if (record.prepared) return
  const operator = m.accounts.find((account) => account.role === 'SUPER_ADMIN')
  if (!operator) throw new Error('Integrations preview: the SUPER_ADMIN demo account is missing')
  await sql(
    m,
    'UPDATE core.users SET "emailVerified" = true WHERE id = :\'id\' AND "emailCanonical" = :\'email\';',
    { id: operator.id, email: operator.email }
  )
  record.prepared = true
  await save(m)
}
