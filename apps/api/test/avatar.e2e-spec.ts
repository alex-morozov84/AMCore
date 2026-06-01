import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

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

  it('uploads a validated public avatar and persists avatarUrl', async () => {
    const { accessToken, userId } = await registerUser()

    const response = await request(app.getHttpServer())
      .post('/auth/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', PNG_1X1, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(201)

    expect(response.body).toEqual({
      avatarUrl: `https://cdn.example.test/assets/avatars/${userId}`,
    })

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    expect(user.avatarUrl).toBe(`https://cdn.example.test/assets/avatars/${userId}`)

    const profileResponse = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
    expect(profileResponse.body.user.avatarUrl).toBe(
      `https://cdn.example.test/assets/avatars/${userId}`
    )
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
})

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}
