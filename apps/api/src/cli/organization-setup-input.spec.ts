import { DEFAULT_LOCALE } from '@amcore/shared'

import {
  organizationSetupEnvironment,
  parseOrganizationSetupArgs,
} from './organization-setup-input'

describe('organization setup input boundary', () => {
  it('accepts the documented forwarding form without password or privilege switches', () => {
    expect(
      parseOrganizationSetupArgs([
        '--',
        'prepare-account',
        '--email',
        'anna@example.test',
        '--locale',
        DEFAULT_LOCALE,
      ])
    ).toEqual({
      command: 'prepare-account',
      input: { email: 'anna@example.test', locale: DEFAULT_LOCALE },
    })
    for (const args of [
      ['prepare-account', '--email', 'anna@example.test', '--password', 'secret'],
      ['prepare-account', '--email', 'anna@example.test', '--verified'],
      ['prepare-account', '--email', 'a@example.test', '--email', 'b@example.test'],
      ['bootstrap', '--name', 'Acme', '--slug', 'acme'],
      ['status', '--unexpected'],
      ['unknown'],
    ])
      expect(() => parseOrganizationSetupArgs(args)).toThrow()
  })

  it('requires explicit database config and production TLS while avoiding unrelated credentials', () => {
    expect(() => organizationSetupEnvironment({})).toThrow()
    const raw = {
      DATABASE_URL: 'postgresql://fake:fake@localhost/test',
      ORG_SELF_SERVICE_CREATION_ENABLED: 'false',
    }
    expect(organizationSetupEnvironment(raw).ORG_SELF_SERVICE_CREATION_ENABLED).toBe(false)
    expect(() => organizationSetupEnvironment({ ...raw, NODE_ENV: 'production' })).toThrow()
    expect(
      organizationSetupEnvironment({
        ...raw,
        DATABASE_URL: `${raw.DATABASE_URL}?sslmode=require`,
        NODE_ENV: 'production',
      })
    ).toBeDefined()
  })
})
