import { parseMfaDeploymentArgs } from './mfa-deployment.js'
import { validateMfaFleetEvidence } from './mfa-deployment-evidence.js'

function fleet() {
  return {
    instances: ['api', 'worker', 'web'].map((role) => ({
      instance: `fixture-${role}`,
      role,
      image: `registry.example.test/fixture@sha256:${'a'.repeat(64)}`,
      artifact: {
        schemaVersion: 1,
        contract: 'account-mfa-v1',
        protocol: 1,
        component: role === 'web' ? 'web' : 'api-worker',
        buildId: 'b'.repeat(64),
        sourceCommit: 'c'.repeat(40),
        recoveryCommand: role !== 'web',
      },
    })),
  }
}
describe('Deployment command accepts only explicit, bounded, image-based prerequisites', () => {
  it('allows local status without a fleet and requires exact activation acknowledgements', () => {
    expect(parseMfaDeploymentArgs(['status'])).toEqual({ command: 'status', fleetFile: undefined })
    expect(
      parseMfaDeploymentArgs(['preflight', '--fleet-file', '/tmp/fake-fleet.json']).command
    ).toBe('preflight')
    expect(
      parseMfaDeploymentArgs([
        'activate',
        '--fleet-file',
        '/tmp/fake-fleet.json',
        '--ingress-drained',
        '--confirm',
        'ACTIVATE MFA V1',
      ]).command
    ).toBe('activate')
  })
  it.each([
    ['activate'],
    ['activate', '--fleet-file', '/tmp/fake'],
    ['activate', '--fleet-file', '/tmp/fake', '--confirm', 'ACTIVATE MFA V1'],
    ['activate', '--fleet-file', '/tmp/fake', '--ingress-drained', '--confirm', 'anything'],
    ['status', '--fleet-file', '/tmp/fake'],
    ['preflight', '--fleet-file', '/tmp/fake', '--ingress-drained'],
    ['preflight', '--fleet-file', '/tmp/fake', '--fleet-file', '/tmp/other'],
    ['status', 'extra'],
  ])('refuses missing or mixed authority %j', (...args) => {
    expect(() => parseMfaDeploymentArgs(args as string[])).toThrow()
  })
  it('accepts same-source capability records for every reference process role', () => {
    const result = validateMfaFleetEvidence(fleet())
    expect(result.sourceCommit).toBe('c'.repeat(40))
    expect(result.evidenceHash).toMatch(/^[a-f0-9]{64}$/)
  })
  it('supports the documented single-process all role without a separate worker replica', () => {
    const input = fleet()
    input.instances[0]!.role = 'all'
    input.instances.splice(1, 1)
    expect(validateMfaFleetEvidence(input).fleet.instances).toHaveLength(2)
  })
  it.each(['source', 'protocol', 'recovery', 'role', 'duplicate', 'missing', 'unpinned'])(
    'refuses incompatible fleet evidence: %s',
    (kind) => {
      const input = fleet(),
        first = input.instances[0]!
      if (kind === 'source') first.artifact.sourceCommit = 'd'.repeat(40)
      if (kind === 'protocol') first.artifact.protocol = 2
      if (kind === 'recovery') first.artifact.recoveryCommand = false
      if (kind === 'role') first.artifact.component = 'web'
      if (kind === 'duplicate') first.instance = input.instances[1]!.instance
      if (kind === 'missing') input.instances.pop()
      if (kind === 'unpinned') first.image = 'registry.example.test/fixture:latest'
      expect(() => validateMfaFleetEvidence(input)).toThrow()
    }
  )
})
