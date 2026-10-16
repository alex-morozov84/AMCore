import {
  organizationCreationIdSchema,
  organizationCreationPolicySchema,
  organizationCreationRequestSchema,
  organizationCreationResultSchema,
  orgResponseSchema,
} from '@amcore/shared'

import { ContextRequestError } from '@/shared/api/bff/context-errors'
import {
  type ContextExecutorInput,
  executeContextOperation,
} from '@/shared/api/bff/context-executor'
import { productContextDeps } from '@/shared/api/bff/product-context-deps'

import 'server-only'

export function readOrganizationCreationPolicy(input: ContextExecutorInput) {
  return executeContextOperation(
    {
      method: 'GET',
      path: '/api/v1/organizations/creation-policy',
      schema: organizationCreationPolicySchema,
      responseBytes: 16384,
      successStatus: 200,
    },
    input,
    productContextDeps(input.headers)
  )
}
export function readOrganizationCreationResult(operationId: string, input: ContextExecutorInput) {
  if (!organizationCreationIdSchema.safeParse(operationId).success)
    throw new ContextRequestError(400, 'BAD_REQUEST')
  return executeContextOperation(
    {
      method: 'GET',
      path: `/api/v1/organizations/creation-results/${operationId}`,
      schema: organizationCreationResultSchema,
      responseBytes: 16384,
      successStatus: 200,
    },
    input,
    productContextDeps(input.headers)
  )
}
export function createOrganization(raw: unknown, input: ContextExecutorInput) {
  const parsed = organizationCreationRequestSchema.safeParse(raw)
  if (!parsed.success) throw new ContextRequestError(400, 'BAD_REQUEST')
  const { operationId, ...body } = parsed.data
  return executeContextOperation(
    {
      method: 'POST',
      path: '/api/v1/organizations',
      body,
      organizationCreationId: operationId,
      schema: orgResponseSchema,
      requestBytes: 4096,
      responseBytes: 16384,
      timeoutMs: 15000,
      successStatus: 201,
    },
    input,
    productContextDeps(input.headers)
  )
}
