import { Injectable, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { integrationItemSchema } from '@amcore/shared'

import type {
  IntegrationReader,
  IntegrationReading,
  IntegrationRegistration,
} from './integration.types.js'
import { IntegrationRegistry } from './integration-registry.js'
import { IntegrationsModule } from './integrations.module.js'

/**
 * The executable twin of "Register a reader" in docs/backend/integrations.md. The code between
 * the markers is the code of the guide; keep the two identical.
 */

// Your existing module that owns the service the reader needs (a stub for this example).
@Injectable()
class CrmStatusService {
  lastSyncStatus = (): {
    enabled: boolean
    lastOk: boolean
    finishedAt: Date
    openTickets: number
  } => ({
    enabled: true,
    lastOk: false,
    finishedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    openTickets: 4,
  })
}
@Module({ providers: [CrmStatusService], exports: [CrmStatusService] })
class CrmModule {}

// --- guide code starts ---
@Injectable()
class CrmIntegrationReader implements IntegrationReader {
  constructor(private readonly crm: CrmStatusService) {}

  read(): Promise<IntegrationReading> {
    const status = this.crm.lastSyncStatus() // stored, already measured; no call to the CRM
    const staleAfterSeconds = 900
    const stale = Date.now() - status.finishedAt.getTime() > staleAfterSeconds * 1000
    return Promise.resolve({
      configuration: status.enabled ? 'configured' : 'disabled',
      evidence: {
        result: status.lastOk ? 'ok' : 'failed',
        freshness: stale ? 'stale' : 'fresh', // the reader judges age; the page re-judges it while open
        scope: 'provider_request',
        instance: 'shared',
        checkedAt: status.finishedAt.toISOString(),
        staleAfterSeconds,
        failure: status.lastOk ? null : 'timeout',
      },
      facts: [{ key: 'open_tickets', value: status.openTickets }],
      links: [],
    })
  }
}

@Module({
  imports: [CrmModule], // the module that exports CrmStatusService
  providers: [CrmIntegrationReader],
  exports: [CrmIntegrationReader],
})
class CrmIntegrationModule {}

const crm: IntegrationRegistration = {
  id: 'crm_sync',
  name: 'CRM sync',
  module: CrmIntegrationModule,
  reader: CrmIntegrationReader,
}
// --- guide code ends ---

describe('the registration example of the guide', () => {
  it('shows a row for the example without any change to the page or the controller', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [IntegrationsModule.register([crm])],
    }).compile()
    await moduleRef.init()
    const response = await moduleRef.get(IntegrationRegistry).list('operator')
    const row = integrationItemSchema.parse(response.items[0])
    expect(response.items).toHaveLength(1)
    expect(row).toMatchObject({
      id: 'crm_sync',
      name: 'CRM sync',
      source: 'ok',
      configuration: 'configured',
      facts: [{ key: 'open_tickets', value: 4 }],
      action: null,
    })
    // A last failed result from yesterday stays failed and is stale; the refresh time is not used.
    expect(row.evidence).toMatchObject({ result: 'failed', freshness: 'stale', failure: 'timeout' })
    await moduleRef.close()
  })

  it('has no row, and is not imported, when its line is removed from the list', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [IntegrationsModule.register([])],
    }).compile()
    await moduleRef.init()
    expect((await moduleRef.get(IntegrationRegistry).list('operator')).items).toEqual([])
    expect(() => moduleRef.get(CrmIntegrationReader, { strict: false })).toThrow()
    await moduleRef.close()
  })
})
