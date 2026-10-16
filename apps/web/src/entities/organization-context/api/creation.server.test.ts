// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const execute = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/shared/api/bff/context-executor', () => ({ executeContextOperation: execute }))
vi.mock('@/shared/api/bff/product-context-deps', () => ({ productContextDeps: () => ({}) }))

import {
  createOrganization,
  readOrganizationCreationPolicy,
  readOrganizationCreationResult,
} from './creation.server'

const operationId = '10000000-0000-4000-8000-000000000001'
const input = { headers: new Headers(), expectedSession: 'a'.repeat(64) }

describe('typed creation operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  it('uses a code-owned creation header, explicit201 and bounded envelopes', () => {
    createOrganization({ name: 'Acme', operationId }, input)
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/v1/organizations',
        method: 'POST',
        organizationCreationId: operationId,
        successStatus: 201,
        body: { name: 'Acme' },
        requestBytes: 4096,
        responseBytes: 16384,
      }),
      input,
      {}
    )
  })
  it('rejects unknown authority fields instead of forwarding them', () => {
    for (const extra of [{ creatorId: 'other' }, { skipPolicy: true }, { role: 'SUPER_ADMIN' }])
      expect(() => createOrganization({ name: 'Acme', operationId, ...extra }, input)).toThrow()
    expect(() => readOrganizationCreationResult('invalid', input)).toThrow()
    expect(execute).not.toHaveBeenCalled()
  })
  it('policy and result recovery are fixed private reads independent of a selected organization', () => {
    readOrganizationCreationPolicy(input)
    readOrganizationCreationResult(operationId, input)
    for (const [operation] of execute.mock.calls)
      expect(operation).toMatchObject({ method: 'GET', successStatus: 200, responseBytes: 16384 })
    expect(execute.mock.calls[1]![0].path).toBe(
      `/api/v1/organizations/creation-results/${operationId}`
    )
  })
})
