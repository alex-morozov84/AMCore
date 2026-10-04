import { validateResponse } from '@bull-board/api/dist/validation.js'
import express from 'express'
import request from 'supertest'

import { chainBoardMiddleware, createBullBoardBoundary } from './bull-board-boundary.middleware'
import { boardCopy } from './bull-board-copy'

/**
 * The boundary answers two routes the board's job page asks for (logs, flow) without reading them.
 * Those bodies must be valid for the board's OWN response schemas, or its UI would show an error.
 */
describe("synthetic board replies are valid for the board's own schemas", () => {
  const app = express()
  app.use('/admin/queues', chainBoardMiddleware(createBullBoardBoundary()))

  const valid = (response: 'GetJobLogsResponse' | 'GetJobFlowResponse', body: unknown) =>
    validateResponse(
      { spec: { response } } as Parameters<typeof validateResponse>[0],
      { status: 200, body } as Parameters<typeof validateResponse>[1]
    )

  it('logs: a list of strings', async () => {
    const res = await request(app).get('/admin/queues/api/queues/email/1/logs')
    expect(res.body).toEqual([boardCopy('en').logsHidden])
    expect(valid('GetJobLogsResponse', res.body).status).toBe(200)
  })

  it('flow: a job that is not part of a flow', async () => {
    const res = await request(app).get('/admin/queues/api/queues/email/1/flow')
    expect(valid('GetJobFlowResponse', res.body).status).toBe(200)
  })

  it('the validator really rejects an incompatible body (so this test can fail)', () => {
    expect(valid('GetJobFlowResponse', { nodeId: 1 }).status).toBe(500)
    expect(valid('GetJobLogsResponse', { logs: [] }).status).toBe(500)
  })
})
