import type { INestApplication } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'
import { AiArtifactKind, AiRunStatus } from '@prisma/client'
import request from 'supertest'

import { seedAiCatalog } from '../prisma/seed-ai-catalog'
import { AiModelRegistry } from '../src/infrastructure/ai/registry/ai-model-registry.service'
import { AiRunDispatchProcessor } from '../src/infrastructure/ai/runs/ai-run-dispatch.processor'
import { AiRunDispatchService } from '../src/infrastructure/ai/runs/ai-run-dispatch.service'
import type { PrismaService } from '../src/prisma'

import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'

/**
 * Arc G merge gate (Track C — ADR-054) — end-to-end proof of the multimodal artifact lifecycle over
 * real Postgres + the durable worker + the memory storage driver: validated upload, producer binding
 * (capability/scope/rebind), worker byte-resolution into a multimodal provider request, and the
 * authorized download access matrix (owner / cross-user operator / unauthorized) with content-free
 * fail-closed audit. Background crons + the wake consumer are stopped so each test drives the
 * dispatcher itself; the key-less mock provider executes runs.
 *
 * The shipped `mock-default` model is text-only, so a test-only `mock-multimodal` model (vision+pdf,
 * same key-less mock adapter) is inserted per test — the OD5 decision (a test catalog fixture, never
 * a public seed change) — and bound via an assistant so a run can carry image/PDF parts.
 */
describe('AI multimodal artifact lifecycle (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext
  let dispatch: AiRunDispatchService
  let registry: AiModelRegistry

  // A valid 1x1 PNG and a minimal PDF — real `file-type` (not the unit mock) detects these by magic
  // bytes, so the upload pipe accepts them exactly as it would a real user file.
  const PNG_BYTES = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
  const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1')

  beforeAll(async () => {
    context = await setupE2ETest()
    app = context.app
    prisma = context.prisma
    dispatch = app.get(AiRunDispatchService, { strict: false })
    registry = app.get(AiModelRegistry, { strict: false })
    const scheduler = app.get(SchedulerRegistry, { strict: false })
    for (const job of scheduler.getCronJobs().values()) job.stop()
    await app.get(AiRunDispatchProcessor, { strict: false }).worker.close()
  }, 120000)

  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)

  beforeEach(async () => {
    await cleanOrgData(prisma)
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
    await seedSystemRoles(prisma)
    await seedAiCatalog(prisma)
    await seedMultimodalMockModel()
    await registry.invalidate() // drop any snapshot cached before the test model existed
  })

  const server = () => app.getHttpServer()

  /** A test-only mock-family model that declares vision+pdf (the shipped mock-default is text-only). */
  async function seedMultimodalMockModel(): Promise<void> {
    const base = await prisma.aiModel.findFirstOrThrow({ where: { slug: 'mock-default' } })
    await prisma.aiModel.create({
      data: {
        providerId: base.providerId,
        slug: 'mock-multimodal',
        providerModelName: base.providerModelName,
        displayName: 'Mock multimodal',
        enabled: true,
        isDefault: false,
        capabilities: { text: true, vision: true, pdf: true },
        contextLimit: base.contextLimit,
        maxOutputTokens: base.maxOutputTokens,
      },
    })
  }

  async function registerHttp(email: string): Promise<{ token: string; userId: string }> {
    const res = await request(server())
      .post('/auth/register')
      .send({ email, password: 'StrongP@ss123' })
      .expect(201)
    return { token: res.body.accessToken as string, userId: res.body.user.id as string }
  }

  /** Promote to SUPER_ADMIN and log back in for a FRESH token carrying the updated role. */
  async function promoteSuperAdmin(userId: string, email: string): Promise<string> {
    await prisma.user.update({ where: { id: userId }, data: { systemRole: 'SUPER_ADMIN' } })
    const res = await request(server())
      .post('/auth/login')
      .send({ email, password: 'StrongP@ss123' })
      .expect(200)
    return res.body.accessToken as string
  }

  let seq = 0
  /** Create an enabled assistant pinning `mock-multimodal` and allowing image+pdf modalities. */
  async function createVisionAssistant(): Promise<string> {
    seq += 1
    const assistant = await prisma.aiAssistant.create({
      data: {
        slug: `g7-${Date.now()}-${seq}`,
        version: 1,
        displayName: 'G7 vision assistant',
        enabled: true,
        modelSelection: { modelSlug: 'mock-multimodal' },
        allowedModalities: ['text', 'image', 'pdf'],
        toolAllowlist: [],
      },
      select: { id: true },
    })
    return assistant.id
  }

  /** POST a conversation as `token` (optionally bound to an assistant). */
  async function createConversation(token: string, assistantId?: string): Promise<string> {
    const res = await request(server())
      .post('/ai/conversations')
      .set('Authorization', `Bearer ${token}`)
      .send(assistantId ? { assistantId } : {})
      .expect(201)
    return res.body.id as string
  }

  /** Upload a PNG/PDF into a conversation as `token`; returns the artifact id. */
  async function uploadArtifact(
    token: string,
    conversationId: string,
    bytes: Buffer,
    filename = 'f.png'
  ): Promise<string> {
    const res = await request(server())
      .post(`/ai/conversations/${conversationId}/artifacts`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', bytes, filename)
      .expect(201)
    return res.body.id as string
  }

  /** Create a run as `token`; returns the run id (does not drain). */
  async function createRun(
    token: string,
    conversationId: string,
    inputParts: unknown[]
  ): Promise<request.Response> {
    return request(server())
      .post('/ai/runs')
      .set('Authorization', `Bearer ${token}`)
      .send({ conversationId, inputParts })
  }

  const TERMINAL: AiRunStatus[] = [
    AiRunStatus.COMPLETED,
    AiRunStatus.FAILED,
    AiRunStatus.CANCELLED,
    AiRunStatus.EXPIRED,
  ]

  /**
   * Drive a run to a terminal status. The durable worker may legitimately re-queue a run after a
   * transient error (a cold-start hiccup on the first multimodal storage/gateway call), so a single
   * drain is not guaranteed to finish it — this drains repeatedly, making any retry immediately due,
   * until the run is terminal. It asserts nothing about WHICH terminal (the caller does that), so a
   * genuinely-broken run still fails the caller's specific status assertion.
   */
  async function driveToTerminal(runId: string): Promise<void> {
    const MAX_DRAINS = 5
    for (let i = 0; i < MAX_DRAINS; i += 1) {
      await dispatch.drainDueBatches()
      const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
      if (TERMINAL.includes(run.status)) return
      if (run.nextAttemptAt) {
        await prisma.aiRun.update({ where: { id: runId }, data: { nextAttemptAt: new Date(0) } })
      }
    }
    // Never reached in a healthy run: fail with a precise diagnostic instead of leaving the caller's
    // status assertion to report an opaque non-terminal status (e.g. QUEUED) after the drains.
    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
    throw new Error(
      `Run ${runId} did not reach a terminal status within ${MAX_DRAINS} drains ` +
        `(status=${run.status}, errorCode=${run.errorCode ?? 'null'}, attemptCount=${run.attemptCount})`
    )
  }

  describe('upload + run + worker resolution (headline)', () => {
    it('resolves an uploaded image into a completed multimodal run, bound to the run + message', async () => {
      const { token } = await registerHttp('g7-owner@example.com')
      const assistantId = await createVisionAssistant()
      const conversationId = await createConversation(token, assistantId)
      const artifactId = await uploadArtifact(token, conversationId, PNG_BYTES)

      // The stored artifact is UNTRUSTED, image, unbound (runId null) until the run binds it.
      const uploaded = await prisma.aiArtifact.findUniqueOrThrow({ where: { id: artifactId } })
      expect(uploaded).toMatchObject({
        kind: AiArtifactKind.IMAGE,
        contentType: 'image/png',
        trustLevel: 'UNTRUSTED',
        conversationId,
        runId: null,
      })
      expect(uploaded.sizeBytes).toBe(PNG_BYTES.length)

      const runRes = await createRun(token, conversationId, [
        { type: 'text', text: 'describe this' },
        { type: 'artifact_ref', artifactId },
      ])
      expect(runRes.status).toBe(201)
      const runId = runRes.body.id as string

      // The artifact is now bound to this run + its USER message, in the same creation transaction.
      const bound = await prisma.aiArtifact.findUniqueOrThrow({ where: { id: artifactId } })
      expect(bound.runId).toBe(runId)
      expect(bound.messageId).not.toBeNull()

      await driveToTerminal(runId)

      const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
      expect(run.status).toBe(AiRunStatus.COMPLETED)
      expect(run.errorCode).toBeNull()
      expect((run.modelSnapshot as { modelSlug: string }).modelSlug).toBe('mock-multimodal')
      // The worker fetched the bytes, assembled a multimodal request, and the mock answered the text.
      const assistant = await prisma.aiMessage.findFirstOrThrow({
        where: { runId, role: 'ASSISTANT' },
      })
      expect((assistant.content as { text: string }[])[0]!.text).toContain('describe this')
    })

    it('resolves an uploaded PDF into a completed run (the file-part / pdf-capability path)', async () => {
      const { token } = await registerHttp('g7-pdf@example.com')
      const conversationId = await createConversation(token, await createVisionAssistant())
      const artifactId = await uploadArtifact(token, conversationId, PDF_BYTES, 'doc.pdf')

      expect((await prisma.aiArtifact.findUniqueOrThrow({ where: { id: artifactId } })).kind).toBe(
        AiArtifactKind.PDF
      )

      const runRes = await createRun(token, conversationId, [
        { type: 'text', text: 'summarize' },
        { type: 'artifact_ref', artifactId },
      ])
      expect(runRes.status).toBe(201)
      await driveToTerminal(runRes.body.id)

      expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: runRes.body.id } })).status).toBe(
        AiRunStatus.COMPLETED
      )
    })

    it('completes an image-only run (no caption) — the fix that makes an artifact-only turn valid', async () => {
      const { token } = await registerHttp('g7-imageonly@example.com')
      const assistantId = await createVisionAssistant()
      const conversationId = await createConversation(token, assistantId)
      const artifactId = await uploadArtifact(token, conversationId, PNG_BYTES)

      const runRes = await createRun(token, conversationId, [{ type: 'artifact_ref', artifactId }])
      expect(runRes.status).toBe(201)

      await driveToTerminal(runRes.body.id)

      const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runRes.body.id } })
      expect(run.status).toBe(AiRunStatus.COMPLETED)
    })
  })

  describe('capability + conversation-scope gates (no run created)', () => {
    it('rejects an image on a text-only (unbound) conversation before run creation (400)', async () => {
      const { token } = await registerHttp('g7-nocap@example.com')
      // No assistant → the credential-gated default resolves to the text-only mock-default.
      const conversationId = await createConversation(token)
      const artifactId = await uploadArtifact(token, conversationId, PNG_BYTES)

      const runRes = await createRun(token, conversationId, [
        { type: 'text', text: 'hi' },
        { type: 'artifact_ref', artifactId },
      ])

      expect(runRes.status).toBe(400)
      expect(await prisma.aiRun.count({ where: { conversationId } })).toBe(0)
      // The artifact stays unbound — nothing was created.
      expect(
        (await prisma.aiArtifact.findUniqueOrThrow({ where: { id: artifactId } })).runId
      ).toBeNull()
    })

    it('rejects a reference to an artifact from a DIFFERENT conversation (400, no leak)', async () => {
      const { token } = await registerHttp('g7-scope@example.com')
      const assistantId = await createVisionAssistant()
      const convA = await createConversation(token, assistantId)
      const convB = await createConversation(token, await createVisionAssistant())
      const artifactInA = await uploadArtifact(token, convA, PNG_BYTES)

      // Reference conv A's artifact from a run on conv B.
      const runRes = await createRun(token, convB, [
        { type: 'artifact_ref', artifactId: artifactInA },
      ])

      expect(runRes.status).toBe(400)
      expect(await prisma.aiRun.count({ where: { conversationId: convB } })).toBe(0)
    })
  })

  describe('rebind matrix', () => {
    it('allows rebinding an artifact whose bound run is terminal FAILED', async () => {
      const { token } = await registerHttp('g7-rebind-ok@example.com')
      const assistantId = await createVisionAssistant()
      const conversationId = await createConversation(token, assistantId)
      const artifactId = await uploadArtifact(token, conversationId, PNG_BYTES)

      // Run 1: a permanent provider refusal → FAILED (the mock throws on __mock_refusal__).
      const run1 = await createRun(token, conversationId, [
        { type: 'text', text: '__mock_refusal__' },
        { type: 'artifact_ref', artifactId },
      ])
      expect(run1.status).toBe(201)
      await driveToTerminal(run1.body.id)
      expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: run1.body.id } })).status).toBe(
        AiRunStatus.FAILED
      )

      // Run 2: reuse the same artifact — rebind allowed off a FAILED run.
      const run2 = await createRun(token, conversationId, [
        { type: 'text', text: 'try again' },
        { type: 'artifact_ref', artifactId },
      ])
      expect(run2.status).toBe(201)
      expect((await prisma.aiArtifact.findUniqueOrThrow({ where: { id: artifactId } })).runId).toBe(
        run2.body.id
      )
    })

    it('rejects rebinding an artifact whose bound run is COMPLETED (409)', async () => {
      const { token } = await registerHttp('g7-rebind-409@example.com')
      const assistantId = await createVisionAssistant()
      const conversationId = await createConversation(token, assistantId)
      const artifactId = await uploadArtifact(token, conversationId, PNG_BYTES)

      const run1 = await createRun(token, conversationId, [
        { type: 'text', text: 'first' },
        { type: 'artifact_ref', artifactId },
      ])
      await driveToTerminal(run1.body.id)
      expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: run1.body.id } })).status).toBe(
        AiRunStatus.COMPLETED
      )

      const run2 = await createRun(token, conversationId, [{ type: 'artifact_ref', artifactId }])
      expect(run2.status).toBe(409)
    })
  })

  describe('download access matrix', () => {
    async function seedOwnedArtifact(): Promise<{
      token: string
      userId: string
      conversationId: string
      artifactId: string
    }> {
      const { token, userId } = await registerHttp(`g7-dl-${Date.now()}-${(seq += 1)}@example.com`)
      const conversationId = await createConversation(token, await createVisionAssistant())
      const artifactId = await uploadArtifact(token, conversationId, PNG_BYTES)
      return { token, userId, conversationId, artifactId }
    }

    it('lets the owner download their own artifact (bytes round-trip, attachment + nosniff)', async () => {
      const { token, conversationId, artifactId } = await seedOwnedArtifact()

      const res = await request(server())
        .get(`/ai/conversations/${conversationId}/artifacts/${artifactId}`)
        .set('Authorization', `Bearer ${token}`)
        .responseType('blob')
        .expect(200)

      expect(res.headers['content-disposition']).toContain('attachment')
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(Buffer.compare(res.body as Buffer, PNG_BYTES)).toBe(0)
      // Owner reads are NOT audited.
      expect(
        await prisma.auditLog.count({ where: { action: 'ai.conversation.artifact_accessed' } })
      ).toBe(0)
    })

    it('lets a cross-user SUPER_ADMIN operator download with fresh-auth + reason, and audits it', async () => {
      const { conversationId, artifactId } = await seedOwnedArtifact()
      const admin = await registerHttp('g7-admin@example.com')
      const adminToken = await promoteSuperAdmin(admin.userId, 'g7-admin@example.com')

      await request(server())
        .get(`/ai/conversations/${conversationId}/artifacts/${artifactId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-amcore-operator-reason', 'SUPPORT-9')
        .responseType('blob')
        .expect(200)

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'ai.conversation.artifact_accessed', targetId: conversationId },
      })
      expect(audit.metadata).toMatchObject({
        conversationId,
        artifactId,
        kind: 'image',
        actorRole: 'operator',
        reasonRef: 'SUPPORT-9',
      })
      // Content-free: no storage key / bytes ever in audit metadata.
      expect(JSON.stringify(audit.metadata)).not.toContain('ai-artifacts/')
    })

    it('cross-user operator with a STALE session → 403 STEP_UP_REQUIRED (no bytes)', async () => {
      const { conversationId, artifactId } = await seedOwnedArtifact()
      const admin = await registerHttp('g7-admin-stale@example.com')
      const adminToken = await promoteSuperAdmin(admin.userId, 'g7-admin-stale@example.com')
      await prisma.session.updateMany({
        where: { userId: admin.userId },
        data: { lastAuthAt: new Date(0) },
      })

      const res = await request(server())
        .get(`/ai/conversations/${conversationId}/artifacts/${artifactId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-amcore-operator-reason', 'SUPPORT-9')
        .expect(403)
      expect(JSON.stringify(res.body)).toContain('STEP_UP_REQUIRED')
    })

    it('hides another regular user’s artifact with a no-leak 404', async () => {
      const { conversationId, artifactId } = await seedOwnedArtifact()
      const other = await registerHttp('g7-other@example.com')

      await request(server())
        .get(`/ai/conversations/${conversationId}/artifacts/${artifactId}`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(404)
    })

    it('404s a missing artifact id in an owned conversation', async () => {
      const { token, conversationId } = await seedOwnedArtifact()
      await request(server())
        .get(`/ai/conversations/${conversationId}/artifacts/nonexistent`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404)
    })
  })

  describe('operator/owner human-turn rejects artifact_ref (Arc G tightening)', () => {
    it('400s a POST /messages carrying an artifact_ref part (owner, holding control)', async () => {
      const { token, userId } = await registerHttp('g7-msg@example.com')
      const conversationId = await createConversation(token, await createVisionAssistant())
      const artifactId = await uploadArtifact(token, conversationId, PNG_BYTES)

      // Take control so a hold-check wouldn't be the reason for rejection — the schema is.
      await request(server())
        .post(`/ai/conversations/${conversationId}/takeover`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(200)

      await request(server())
        .post(`/ai/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: [{ type: 'artifact_ref', artifactId }] })
        .expect(400)

      expect(userId).toBeTruthy()
    })
  })
})
