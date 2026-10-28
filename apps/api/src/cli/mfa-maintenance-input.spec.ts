import { mfaMaintenanceEnvironment, parseMfaMaintenanceArgs } from './mfa-maintenance-input'

describe('MFA maintenance input owns only an explicit DB and keyring boundary', () => {
  it('accepts the bounded rotation command and explicit continuation cursor', () => {
    expect(parseMfaMaintenanceArgs(['rotate-key'])).toEqual({})
    expect(parseMfaMaintenanceArgs(['--', 'rotate-key', '--after-user-id', 'account-100'])).toEqual(
      { afterUserId: 'account-100' }
    )
  })
  it.each([
    [],
    ['activate'],
    ['recover'],
    ['rotate-key', '--secret', '<fake-key>'],
    ['rotate-key', '--after-user-id', 'A', '--after-user-id', 'B'],
    ['rotate-key', 'unexpected'],
    ['rotate-key', '--after-user-id', ''],
  ])('refuses unimplemented commands, secrets, duplicates and positionals %j', (...args) => {
    expect(() => parseMfaMaintenanceArgs(args as string[])).toThrow()
  })
  it('does not require a JWT/Redis/HTTP environment and rejects a plaintext production datasource', () => {
    const raw = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://fake:fake@localhost/fake',
      MFA_ACTIVE_KEY_ID: 'next',
    }
    expect(mfaMaintenanceEnvironment(raw)).toMatchObject(raw)
    expect(() => mfaMaintenanceEnvironment({ ...raw, NODE_ENV: 'production' })).toThrow()
    expect(() =>
      mfaMaintenanceEnvironment({ ...raw, DATABASE_URL: 'https://example.test/fake' })
    ).toThrow()
    expect(() => mfaMaintenanceEnvironment({ NODE_ENV: 'test' })).toThrow()
  })
})
