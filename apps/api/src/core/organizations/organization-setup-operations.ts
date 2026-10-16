import type {
  OrganizationBootstrap,
  OrganizationBootstrapResult,
  OrganizationPrepareAccount,
  OrganizationPreparedAccount,
  OrganizationSetupAccount,
  OrganizationSetupStatus,
} from '@amcore/shared'

import { canonicalAdmin } from './canonical-admin'
import {
  establishmentError,
  establishmentFailure,
  isCanonicalEmailConflict,
  isOrganizationSlugConflict,
} from './establishment-error'
import {
  INITIAL_ORGANIZATION_KEY,
  readEstablishmentResult,
  resultIds,
} from './establishment-result'
import {
  type EstablishmentDatabase,
  establishmentTransaction,
  lockInitialSetup,
} from './establishment-transaction'
import { establishmentFingerprint, writeEstablishedOrganization } from './establishment-write'
import { prepareSetupAccount } from './organization-setup-accounts'
import { admitSetupOperator, type SetupOperator } from './organization-setup-admission'
import { assertSetupEligible, mutationSetupState, readSetupState } from './organization-setup-state'

/** Shared initial-only operations. No HTTP, shell, listeners, queues or full application bootstrap. */
export class OrganizationSetupOperations {
  constructor(
    private readonly db: EstablishmentDatabase,
    private readonly creationEnabled: boolean
  ) {}

  async status(operator?: SetupOperator): Promise<OrganizationSetupStatus> {
    try {
      return await establishmentTransaction(this.db, async (tx) => {
        await admitSetupOperator(tx, operator)
        return readSetupState(tx, this.creationEnabled)
      })
    } catch (error) {
      return establishmentFailure(error, true)
    }
  }

  async account(userId: string, operator?: SetupOperator): Promise<OrganizationSetupAccount> {
    try {
      return await establishmentTransaction(this.db, async (tx) => {
        await admitSetupOperator(tx, operator)
        const state = await readSetupState(tx, this.creationEnabled)
        if (state.state !== 'eligible-empty' && state.ids?.userId !== userId)
          throw establishmentError('SETUP_CLOSED')
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { email: true, emailVerified: true },
        })
        if (!user) throw establishmentError('SETUP_ACCOUNT_UNAVAILABLE', 404)
        return { userId, ...user, state: state.state }
      })
    } catch (error) {
      return establishmentFailure(error, true)
    }
  }

  async prepare(
    input: OrganizationPrepareAccount,
    operator?: SetupOperator
  ): Promise<OrganizationPreparedAccount> {
    // A uniqueness abort starts a NEW eligibility transaction; never bypass closure with root lookup.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await establishmentTransaction(this.db, async (tx) => {
          await lockInitialSetup(tx, !!operator)
          assertSetupEligible(await mutationSetupState(tx, this.creationEnabled))
          return prepareSetupAccount(tx, input, operator)
        })
      } catch (error) {
        if (isCanonicalEmailConflict(error) && attempt === 0) continue
        return establishmentFailure(error, true)
      }
    }
    throw establishmentError('SETUP_UNCONFIRMED', 503)
  }

  async bootstrap(
    input: OrganizationBootstrap,
    operator?: SetupOperator
  ): Promise<OrganizationBootstrapResult> {
    const canonicalInputHash = establishmentFingerprint(input)
    try {
      const result = await establishmentTransaction(this.db, async (tx) => {
        await lockInitialSetup(tx, !!operator)
        const state = await mutationSetupState(tx, this.creationEnabled)
        if (state === 'completed') return null
        assertSetupEligible(state)
        const [user] = await tx.$queryRaw<{ id: string; emailVerified: boolean }[]>`
          SELECT id, "emailVerified" FROM core.users WHERE id = ${input.adminUserId} FOR SHARE`
        if (!user) throw establishmentError('SETUP_ACCOUNT_UNAVAILABLE', 422)
        if (!user.emailVerified) throw establishmentError('SETUP_EMAIL_UNVERIFIED', 422)
        const adminRoleId = await canonicalAdmin(tx)
        await admitSetupOperator(tx, operator, true)
        const { ids } = await writeEstablishedOrganization(
          tx,
          user.id,
          adminRoleId,
          { name: input.name, slug: input.slug },
          {
            id: operator?.principal.sub ?? null,
            source: operator ? 'bootstrap-console' : 'bootstrap-cli',
          }
        )
        const receipt = await tx.organizationBootstrapResult.create({
          data: {
            key: INITIAL_ORGANIZATION_KEY,
            canonicalInputHash,
            ...ids,
          },
        })
        return { status: 'created' as const, ids, completedAt: receipt.completedAt.toISOString() }
      })
      if (result) return result
      // Never join/lock an existing org parent while holding the setup SRE lock.
      return await establishmentTransaction(this.db, async (tx) => {
        await admitSetupOperator(tx, operator, true)
        const row = await readEstablishmentResult(tx, 'bootstrap')
        if (!row) throw establishmentError('SETUP_UNCONFIRMED', 503)
        if (row.canonicalInputHash !== canonicalInputHash)
          throw establishmentError('SETUP_INTENT_MISMATCH')
        if (!row.intact) throw establishmentError('SETUP_STATE_CHANGED')
        return {
          status: 'already_completed',
          ids: resultIds(row),
          completedAt: row.completedAt.toISOString(),
        }
      })
    } catch (error) {
      if (isOrganizationSlugConflict(error)) throw establishmentError('CONFLICT')
      return establishmentFailure(error, true)
    }
  }
}
