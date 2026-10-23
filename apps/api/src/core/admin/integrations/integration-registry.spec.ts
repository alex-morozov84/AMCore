import { Injectable, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import type {
  IntegrationProbePort,
  IntegrationReader,
  IntegrationReading,
  IntegrationRegistration,
} from './integration.types.js'
import { IntegrationRegistry } from './integration-registry.js'
import { validateRegistrations } from './integration-validation.js'
import { IntegrationsModule } from './integrations.module.js'

const NONE = {
  result: 'none',
  freshness: 'none',
  scope: 'configuration_only',
  instance: 'answering_instance',
  checkedAt: null,
  staleAfterSeconds: null,
  failure: null,
} as const

function readingOf(overrides: Partial<IntegrationReading> = {}): IntegrationReading {
  return { configuration: 'configured', evidence: NONE, facts: [], links: [], ...overrides }
}

@Injectable()
class DemoReader implements IntegrationReader {
  read(): Promise<IntegrationReading> {
    return Promise.resolve(readingOf({ facts: [{ key: 'bots', value: 2 }] }))
  }
}
@Module({ providers: [DemoReader], exports: [DemoReader] })
class DemoModule {}

@Injectable()
class BrokenReader implements IntegrationReader {
  read(): Promise<IntegrationReading> {
    return Promise.reject(new Error('secret-token-12345'))
  }
}
@Module({ providers: [BrokenReader], exports: [BrokenReader] })
class BrokenModule {}

@Injectable()
class FreeTextReader implements IntegrationReader {
  read(): Promise<IntegrationReading> {
    return Promise.resolve(readingOf({ facts: [{ key: 'note', value: 'https://x.test/?k=1' }] }))
  }
}
@Module({ providers: [FreeTextReader], exports: [FreeTextReader] })
class FreeTextModule {}

@Injectable()
class DemoProbe implements IntegrationProbePort {
  action = jest.fn().mockResolvedValue({
    probeId: 'demo_probe',
    kind: 'operator_email_test',
    available: true,
    unavailableReason: null,
    cooldownRemainingSeconds: 0,
    ownAttemptId: null,
  })
  prepare = jest.fn()
  run = jest.fn()
  receiptFor = jest.fn()
}
@Module({ providers: [DemoProbe], exports: [DemoProbe] })
class ProbeModule {}

const POLICY = {
  deadlineMs: 10_000,
  operatorCooldownSeconds: 60,
  platformPerHour: 20,
  leaseSeconds: 30,
}

const demo: IntegrationRegistration = {
  id: 'demo',
  name: 'Demo',
  module: DemoModule,
  reader: DemoReader,
}

async function boot(registrations: IntegrationRegistration[]) {
  const moduleRef = await Test.createTestingModule({
    imports: [IntegrationsModule.register(registrations)],
  }).compile()
  await moduleRef.init()
  return moduleRef
}

describe('validateRegistrations', () => {
  it('rejects a bad or duplicate id, a long name and a duplicate reader', () => {
    expect(() => validateRegistrations([{ ...demo, id: 'Bad-Id' }])).toThrow(
      'Invalid integration id'
    )
    expect(() => validateRegistrations([demo, demo])).toThrow('Duplicate integration')
    expect(() => validateRegistrations([{ ...demo, name: 'x'.repeat(49) }])).toThrow(
      'Invalid integration name'
    )
    expect(() => validateRegistrations([demo, { ...demo, id: 'other' }])).toThrow(
      'Duplicate integration reader'
    )
  })

  it('rejects an unsafe probe policy and an unknown kind', () => {
    const probe = {
      id: 'demo_probe',
      kind: 'operator_email_test' as const,
      policy: POLICY,
      port: DemoProbe,
    }
    expect(() => validateRegistrations([{ ...demo, probe }])).not.toThrow()
    expect(() =>
      validateRegistrations([
        { ...demo, probe: { ...probe, policy: { ...POLICY, operatorCooldownSeconds: 5 } } },
      ])
    ).toThrow('unsafe probe policy')
    expect(() =>
      validateRegistrations([
        { ...demo, probe: { ...probe, policy: { ...POLICY, leaseSeconds: 12 } } },
      ])
    ).toThrow('unsafe probe policy')
    expect(() =>
      validateRegistrations([{ ...demo, probe: { ...probe, kind: 'send_anything' as never } }])
    ).toThrow('Unknown probe kind')
  })
})

describe('IntegrationRegistry', () => {
  it('shows a custom registration without any change to the response shape', async () => {
    const moduleRef = await boot([demo])
    const response = await moduleRef.get(IntegrationRegistry).list('operator')
    expect(response.items).toEqual([
      expect.objectContaining({
        id: 'demo',
        name: 'Demo',
        source: 'ok',
        configuration: 'configured',
        facts: [{ key: 'bots', value: 2 }],
        action: null,
      }),
    ])
    await moduleRef.close()
  })

  it('fails startup when a registered probe port is not provided by any module', async () => {
    const probe = {
      id: 'demo_probe',
      kind: 'operator_email_test' as const,
      policy: POLICY,
      port: DemoProbe,
    }
    await expect(boot([{ ...demo, probe }])).rejects.toThrow()
  })

  it('isolates one failing reader and never leaks its error text', async () => {
    const moduleRef = await boot([
      demo,
      { id: 'broken', name: 'Broken', module: BrokenModule, reader: BrokenReader },
    ])
    const response = await moduleRef.get(IntegrationRegistry).list('operator')
    expect(response.items.map((item) => [item.id, item.source])).toEqual([
      ['demo', 'ok'],
      ['broken', 'unavailable'],
    ])
    expect(JSON.stringify(response)).not.toContain('secret-token-12345')
    await moduleRef.close()
  })

  it('treats a reading with unsafe free text as an unreadable source', async () => {
    const moduleRef = await boot([
      { id: 'free', name: 'Free', module: FreeTextModule, reader: FreeTextReader },
    ])
    const response = await moduleRef.get(IntegrationRegistry).list('operator')
    expect(response.items[0]).toMatchObject({ source: 'unavailable', facts: [] })
    await moduleRef.close()
  })

  it('resolves registered ports after bootstrap and exposes only registered probes', async () => {
    const probe = {
      id: 'demo_probe',
      kind: 'operator_email_test' as const,
      policy: POLICY,
      port: DemoProbe,
    }
    const moduleRef = await Test.createTestingModule({
      imports: [IntegrationsModule.register([{ ...demo, probe }]), ProbeModule],
    }).compile()
    await moduleRef.init()
    const registry = moduleRef.get(IntegrationRegistry)
    expect(registry.probe('demo')?.port).toBeInstanceOf(DemoProbe)
    expect(registry.probe('demo')?.policy).toEqual(POLICY)
    expect(registry.probe('missing')).toBeNull()
    const response = await registry.list('operator')
    expect(response.items[0]?.action).toMatchObject({ probeId: 'demo_probe', available: true })
    await moduleRef.close()
  })
})

describe('startup contract (C6) and the kind envelope (C3)', () => {
  const probeOf = (policy: Partial<typeof POLICY>) => ({
    ...demo,
    probe: {
      id: 'demo_probe',
      kind: 'operator_email_test' as const,
      policy: { ...POLICY, ...policy },
      port: DemoProbe,
    },
  })

  it('rejects a policy that is not made of finite whole numbers', () => {
    for (const bad of [
      { operatorCooldownSeconds: Infinity },
      { leaseSeconds: Infinity },
      { platformPerHour: 2.5 },
      { deadlineMs: Number.NaN },
      { deadlineMs: 9_999.5 },
    ])
      expect(() => validateRegistrations([probeOf(bad)])).toThrow('unsafe probe policy')
  })

  it('does not let a registration loosen what its kind allows', () => {
    // Valid for the generic bounds, but looser than the reviewed email-test kind.
    for (const loose of [
      { operatorCooldownSeconds: 45 },
      { platformPerHour: 21 },
      { deadlineMs: 20_000, leaseSeconds: 60 },
    ])
      expect(() => validateRegistrations([probeOf(loose)])).toThrow('unsafe probe policy')
    expect(() =>
      validateRegistrations([probeOf({ operatorCooldownSeconds: 120, platformPerHour: 5 })])
    ).not.toThrow()
  })

  it('fails startup when the provided probe port is incomplete', async () => {
    @Injectable()
    class EmptyProbe {}
    @Module({ providers: [EmptyProbe], exports: [EmptyProbe] })
    class EmptyProbeModule {}
    const registration = {
      ...probeOf({}),
      probe: { ...probeOf({}).probe, port: EmptyProbe as never },
    }
    await expect(
      Test.createTestingModule({
        imports: [IntegrationsModule.register([registration]), EmptyProbeModule],
      })
        .compile()
        .then((moduleRef) => moduleRef.init())
    ).rejects.toThrow('does not match its registration')
  })
})

describe('the whole row is bounded (C4)', () => {
  @Injectable()
  class SlowActionProbe extends DemoProbe {
    override action = jest.fn(() => new Promise<never>(() => undefined))
  }
  @Module({ providers: [SlowActionProbe], exports: [SlowActionProbe] })
  class SlowActionModule {}

  it('returns the neighbouring rows and keeps the reading when only the action hangs', async () => {
    const probe = {
      id: 'demo_probe',
      kind: 'operator_email_test' as const,
      policy: POLICY,
      port: SlowActionProbe,
    }
    const moduleRef = await Test.createTestingModule({
      imports: [
        IntegrationsModule.register([
          { ...demo, probe },
          { id: 'other', name: 'Other', module: FreeTextOkModule, reader: FreeTextOkReader },
        ]),
        SlowActionModule,
      ],
    }).compile()
    await moduleRef.init()
    const registry = moduleRef.get(IntegrationRegistry)
    const started = Date.now()
    const first = await registry.list('operator')
    const second = await registry.list('operator')
    expect(Date.now() - started).toBeLessThan(4_000)
    for (const response of [first, second]) {
      expect(response.items.map((item) => [item.id, item.source, item.action])).toEqual([
        ['demo', 'ok', null],
        ['other', 'ok', null],
      ])
    }
    await moduleRef.close()
  }, 10_000)
})

@Injectable()
class FreeTextOkReader implements IntegrationReader {
  read(): Promise<IntegrationReading> {
    return Promise.resolve(readingOf())
  }
}
@Module({ providers: [FreeTextOkReader], exports: [FreeTextOkReader] })
class FreeTextOkModule {}
