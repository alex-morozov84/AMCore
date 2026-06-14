import { access, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { RedisThrottlerStorage } from '../src/infrastructure/throttling'
import type { PrismaService } from '../src/prisma'

import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
)

describe('Avatar storage (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext
  let storageRoot: string
  let previousStorageDriver: string | undefined
  let previousStorageLocalRoot: string | undefined
  let previousStorageLocalPublicBaseUrl: string | undefined

  beforeAll(async () => {
    previousStorageDriver = process.env.STORAGE_DRIVER
    previousStorageLocalRoot = process.env.STORAGE_LOCAL_ROOT
    previousStorageLocalPublicBaseUrl = process.env.STORAGE_LOCAL_PUBLIC_BASE_URL

    storageRoot = await mkdtemp(path.join(tmpdir(), 'amcore-avatar-storage-'))
    process.env.STORAGE_DRIVER = 'local'
    process.env.STORAGE_LOCAL_ROOT = storageRoot
    process.env.STORAGE_LOCAL_PUBLIC_BASE_URL = 'https://cdn.example.test/assets'

    context = await setupE2ETest()
    app = context.app
    prisma = context.prisma
  }, 120000)

  afterAll(async () => {
    await teardownE2ETest(context)
    await rm(storageRoot, { recursive: true, force: true })

    restoreEnv('STORAGE_DRIVER', previousStorageDriver)
    restoreEnv('STORAGE_LOCAL_ROOT', previousStorageLocalRoot)
    restoreEnv('STORAGE_LOCAL_PUBLIC_BASE_URL', previousStorageLocalPublicBaseUrl)
  }, 120000)

  beforeEach(async () => {
    await cleanOrgData(prisma)
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
  })

  async function registerUser(email = 'avatar@example.com'): Promise<{
    accessToken: string
    userId: string
  }> {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'AvatarP@ss123', name: 'Avatar User' })
      .expect(201)

    return {
      accessToken: response.body.accessToken as string,
      userId: response.body.user.id as string,
    }
  }

  it('requires bearer auth for avatar upload and delete', async () => {
    await request(app.getHttpServer())
      .post('/auth/me/avatar')
      .attach('file', PNG_1X1, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(401)

    await request(app.getHttpServer()).delete('/auth/me/avatar').expect(401)
  })

  // Version is rendered `v-<generation>-<rand>` (the monotonic fence prefix).
  const avatarUrlPattern = (userId: string): RegExp =>
    new RegExp(
      `^https://cdn\\.example\\.test/assets/avatars/${userId}/v-[0-9]+-[0-9a-z]+/avatar-256\\.webp$`
    )

  it('uploads a validated public avatar derivative and persists avatarUrl', async () => {
    const { accessToken, userId } = await registerUser()

    const response = await request(app.getHttpServer())
      .post('/auth/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', PNG_1X1, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(201)

    expect(response.body.avatarUrl).toMatch(avatarUrlPattern(userId))

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    expect(user.avatarUrl).toBe(response.body.avatarUrl)

    const profileResponse = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
    expect(profileResponse.body.user.avatarUrl).toBe(response.body.avatarUrl)
  })

  it('re-upload publishes a new versioned URL', async () => {
    const { accessToken, userId } = await registerUser()

    const first = await request(app.getHttpServer())
      .post('/auth/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', PNG_1X1, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(201)

    const second = await request(app.getHttpServer())
      .post('/auth/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', PNG_1X1, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(201)

    expect(second.body.avatarUrl).toMatch(avatarUrlPattern(userId))
    expect(second.body.avatarUrl).not.toBe(first.body.avatarUrl)
  })

  it('rejects oversized avatars with 413', async () => {
    const { accessToken } = await registerUser()
    const oversizedPng = Buffer.concat([PNG_1X1, Buffer.alloc(2 * 1024 * 1024)])

    await request(app.getHttpServer())
      .post('/auth/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', oversizedPng, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(413)
  })

  it('rejects spoofed executables and svg avatars with 400', async () => {
    const { accessToken } = await registerUser()

    await request(app.getHttpServer())
      .post('/auth/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(128)]), {
        filename: 'avatar.png',
        contentType: 'image/png',
      })
      .expect(400)

    await request(app.getHttpServer())
      .post('/auth/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), {
        filename: 'avatar.svg',
        contentType: 'image/svg+xml',
      })
      .expect(400)
  })

  it('deletes avatar idempotently', async () => {
    const { accessToken, userId } = await registerUser()

    await request(app.getHttpServer())
      .post('/auth/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', PNG_1X1, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(201)

    await request(app.getHttpServer())
      .delete('/auth/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204)

    await request(app.getHttpServer())
      .delete('/auth/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204)

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    expect(user.avatarUrl).toBeNull()
  })

  // Resolve the local file backing a public avatar URL so concurrency tests can
  // assert the surviving DB pointer references storage that actually exists. The
  // local driver stores object bytes under `<root>/objects/<key>`; the public
  // base URL maps to that `objects/` mount (see LocalStorageConfig.publicBaseUrl).
  const STORAGE_PUBLIC_PREFIX = 'https://cdn.example.test/assets/'
  const STORAGE_OBJECTS_DIR = 'objects'
  const fileFor = (avatarUrl: string): string =>
    path.join(storageRoot, STORAGE_OBJECTS_DIR, avatarUrl.slice(STORAGE_PUBLIC_PREFIX.length))

  it('serializes concurrent uploads: the surviving avatarUrl resolves to live storage', async () => {
    const { accessToken, userId } = await registerUser()

    const upload = (): request.Test =>
      request(app.getHttpServer())
        .post('/auth/me/avatar')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', PNG_1X1, { filename: 'avatar.png', contentType: 'image/png' })

    const [a, b] = await Promise.all([upload(), upload()])
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)

    // The DB winner must point to a file that still exists (no cross-version sweep).
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    expect(user.avatarUrl).toMatch(avatarUrlPattern(userId))
    await expect(access(fileFor(user.avatarUrl as string))).resolves.toBeUndefined()

    // The loser's published derivative was swept: exactly one version still has a
    // live avatar-256 file (empty version dirs may linger — file delete does not
    // prune them on the local driver; S3 has no directories).
    const versionDirs = await readdir(
      path.join(storageRoot, STORAGE_OBJECTS_DIR, 'avatars', userId)
    )
    const liveVersions = (
      await Promise.all(
        versionDirs.map(async (dir) => {
          const file = path.join(
            storageRoot,
            STORAGE_OBJECTS_DIR,
            'avatars',
            userId,
            dir,
            'avatar-256.webp'
          )
          return access(file).then(
            () => dir,
            () => undefined
          )
        })
      )
    ).filter((dir): dir is string => dir !== undefined)
    expect(liveVersions).toHaveLength(1)
    expect(user.avatarUrl).toContain(`/${liveVersions[0]}/`)
  })

  it('keeps the store consistent under a concurrent upload and delete', async () => {
    const { accessToken, userId } = await registerUser()

    await request(app.getHttpServer())
      .post('/auth/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', PNG_1X1, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(201)

    await Promise.all([
      request(app.getHttpServer())
        .post('/auth/me/avatar')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', PNG_1X1, { filename: 'avatar.png', contentType: 'image/png' }),
      request(app.getHttpServer())
        .delete('/auth/me/avatar')
        .set('Authorization', `Bearer ${accessToken}`),
    ])

    // Whichever ran last, the invariant holds: a non-null avatarUrl must resolve
    // to live storage; a null one means the avatar was fully removed.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    const state = user.avatarUrl
      ? await access(fileFor(user.avatarUrl)).then(
          () => 'live',
          () => 'orphaned'
        )
      : 'removed'
    expect(state).not.toBe('orphaned')
  })

  it('throttles avatar uploads per IP (F12)', async () => {
    const { accessToken } = await registerUser()

    // The per-handler override narrows the `long` bucket to 5/min for this route.
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/auth/me/avatar')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', PNG_1X1, { filename: 'avatar.png', contentType: 'image/png' })
        .expect(201)
    }

    await request(app.getHttpServer())
      .post('/auth/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', PNG_1X1, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(429)
  })

  it('wires the global guard to the Redis-backed throttler storage (ADR-039)', () => {
    // Guards against a config that builds the storage but fails to pass it to
    // ThrottlerModule, silently falling back to in-memory (process-local) limits.
    expect(context.throttlerStorage).toBeInstanceOf(RedisThrottlerStorage)
  })
})

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}
