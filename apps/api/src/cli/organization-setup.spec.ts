import { runOrganizationSetup } from './organization-setup'

describe('organization setup standalone boundary', () => {
  it('rejects invalid input before any DB use and prints no configured values', async () => {
    const output = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      expect(await runOrganizationSetup(['prepare-account', '--password', 'fake'], {})).toBe(2)
      expect(JSON.parse(output.mock.calls[0]![0] as string)).toMatchObject({
        status: 'invalid_input',
      })
      expect(output.mock.calls.flat().join('')).not.toContain('fake')
    } finally {
      output.mockRestore()
    }
  })

  it('reports unavailable database safely with no JWT, Redis or full application initialization', async () => {
    const output = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      const code = await runOrganizationSetup(['status'], {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://fake:fake@127.0.0.1:1/fake',
        ORG_SELF_SERVICE_CREATION_ENABLED: 'false',
      })
      expect(code).toBe(4)
      expect(output).toHaveBeenCalledTimes(1)
      const body = output.mock.calls[0]![0] as string
      expect(JSON.parse(body)).toMatchObject({ status: 'SETUP_UNCONFIRMED', state: 'unavailable' })
      expect(body).not.toMatch(/postgres|fake|127\.0\.0\.1|password|token/i)
    } finally {
      output.mockRestore()
    }
  })
})
