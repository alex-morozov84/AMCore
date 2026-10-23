import { Injectable, Module } from '@nestjs/common'

import { StorageProbeService } from '../../../../infrastructure/storage/index.js'
import type { IntegrationReader, IntegrationReading } from '../integration.types.js'

/**
 * Files: the cached write-read-delete observation of the answering API instance. Reads the stored
 * snapshot only; it never starts a check. A stale snapshot keeps its last failure.
 */
@Injectable()
export class StorageIntegrationReader implements IntegrationReader {
  constructor(private readonly probe: StorageProbeService) {}

  read(): Promise<IntegrationReading> {
    const snapshot = this.probe.snapshot()
    const observed = snapshot.checkedAt !== null
    return Promise.resolve({
      configuration: 'configured',
      evidence: {
        result: !observed ? 'none' : snapshot.failure ? 'failed' : 'ok',
        freshness: !observed ? 'none' : snapshot.state === 'stale' ? 'stale' : 'fresh',
        scope: 'private_file_write_read_delete',
        instance: 'answering_instance',
        checkedAt: snapshot.checkedAt,
        staleAfterSeconds: snapshot.staleAfterSeconds,
        failure: snapshot.failure,
      },
      facts: [
        { key: 'driver', value: snapshot.driver },
        { key: 'interval_seconds', value: snapshot.intervalSeconds },
      ],
      links: ['overview'],
    })
  }
}

@Module({ providers: [StorageIntegrationReader], exports: [StorageIntegrationReader] })
export class StorageIntegrationModule {}
