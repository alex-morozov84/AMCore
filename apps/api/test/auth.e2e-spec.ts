import type { INestApplication } from '@nestjs/common'
import type { Response } from 'supertest'
import request from 'supertest'

import type { PrismaService } from '../src/prisma'

import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

/**
 * Extract refresh token from response cookies
 */
function extractRefreshToken(response: Response): string {
  const cookies = response.headers['set-cookie'] as unknown as string[]
  const refreshCookie = cookies.find((c) => c.startsWith('refresh_token='))!
  return refreshCookie.split(';')[0]!.split('=')[1]!
}

/**
 * Check if response has refresh token cookie
 */
function hasRefreshTokenCookie(response: Response): boolean {
  const cookies = response.headers['set-cookie'] as unknown as string[]
  return cookies ? cookies.some((c) => c.startsWith('refresh_token=')) : false
}

describe('Auth (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext

  beforeAll(async () => {
    // Ensure environment variables are set early
    if (!process.env.REDIS_URL) {
      process.env.REDIS_URL = 'redis://localhost:6379' // fallback
    }

    context = await setupE2ETest()
    app = context.app
    prisma = context.prisma
  }, 120000) // 2 min timeout for container start

  afterAll(async () => {
    await teardownE2ETest(context)
  })

  beforeEach(async () => {
    await cleanDatabase(prisma)
  })

  describe('POST /auth/register', () => {
    it('should register new user with valid data', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'newuser@example.com',
          password: 'StrongP@ss123',
          name: 'New User',
        })
        .expect(201)

      expect(response.body).toMatchObject({
        user: {
          email: 'newuser@example.com',
          name: 'New User',
          emailVerified: false,
        },
        accessToken: expect.any(String),
      })

      // Check refresh_token cookie is set
      expect(hasRefreshTokenCookie(response)).toBe(true)

      // Verify user exists in database
      const user = await prisma.user.findUnique({
        where: { email: 'newuser@example.com' },
      })
      expect(user).toBeDefined()
      expect(user?.name).toBe('New User')
    })

    it('should register user without name', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'noname@example.com',
          password: 'StrongP@ss123',
        })
        .expect(201)

      expect(response.body.user.name).toBeNull()
    })

    it('should return 409 if user already exists', async () => {
      const registerData = {
        email: 'duplicate@example.com',
        password: 'StrongP@ss123',
      }

      // First registration
      await request(app.getHttpServer()).post('/auth/register').send(registerData).expect(201)

      // Duplicate registration
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerData)
        .expect(409)

      expect(response.body.message).toContain('уже существует')
    })

    it('should return 400 for invalid email', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'invalid-email',
          password: 'StrongP@ss123',
        })
        .expect(400)

      expect(response.body.message).toBeDefined()
    })

    it('should return 400 for weak password', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'test@example.com',
          password: 'weak',
        })
        .expect(400)

      expect(response.body.message).toBeDefined()
    })

    it('should create session in database', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'session@example.com',
          password: 'StrongP@ss123',
        })
        .expect(201)

      expect(response.body.user).toBeDefined()

      const sessions = await prisma.session.findMany()
      expect(sessions).toHaveLength(1)
      expect(sessions[0]!.userAgent).toBeDefined()
    })
  })

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      // Create test user
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'login@example.com',
          password: 'LoginP@ss123',
          name: 'Login User',
        })
        .expect(201)
    })

    it('should login with valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'login@example.com',
          password: 'LoginP@ss123',
        })
        .expect(200)

      expect(response.body).toMatchObject({
        user: {
          email: 'login@example.com',
          name: 'Login User',
        },
        accessToken: expect.any(String),
      })

      expect(hasRefreshTokenCookie(response)).toBe(true)
    })

    it('should return 401 for wrong password', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'login@example.com',
          password: 'WrongPassword123',
        })
        .expect(401)

      expect(response.body.message).toContain('Неверный')
    })

    it('should return 401 for non-existent user', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'Password123',
        })
        .expect(401)

      expect(response.body.message).toBeDefined()
    })

    it('should update lastLoginAt timestamp', async () => {
      const userBefore = await prisma.user.findUnique({
        where: { email: 'login@example.com' },
      })
      const lastLoginBefore = userBefore!.lastLoginAt

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 100))

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'login@example.com',
          password: 'LoginP@ss123',
        })
        .expect(200)

      const userAfter = await prisma.user.findUnique({
        where: { email: 'login@example.com' },
      })

      expect(userAfter!.lastLoginAt!.getTime()).toBeGreaterThan(lastLoginBefore!.getTime())
    })
  })

  describe('POST /auth/logout', () => {
    let refreshToken: string

    beforeEach(async () => {
      // Register and get refresh token
      const response = await request(app.getHttpServer()).post('/auth/register').send({
        email: 'logout@example.com',
        password: 'LogoutP@ss123',
      })

      refreshToken = extractRefreshToken(response)
    })

    it('should logout and clear cookie', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', `refresh_token=${refreshToken}`)
        .expect(200)

      expect(response.body.message).toContain('вышли из системы')

      // Check cookie is cleared
      const cookies = response.headers['set-cookie'] as unknown as string[]
      expect(cookies.some((c) => c.includes('refresh_token=;'))).toBe(true)
    })

    it('should delete session from database', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', `refresh_token=${refreshToken}`)
        .expect(200)

      expect(response.body.message).toBeDefined()

      const sessions = await prisma.session.findMany()
      expect(sessions).toHaveLength(0)
    })

    it('should return 200 even without refresh token', async () => {
      const response = await request(app.getHttpServer()).post('/auth/logout').expect(200)

      expect(response.body.message).toBeDefined()
    })
  })

  describe('POST /auth/refresh', () => {
    let agent: ReturnType<typeof request.agent>
    let refreshToken: string

    beforeEach(async () => {
      // Create agent to persist cookies between requests
      agent = request.agent(app.getHttpServer())

      const response = await agent.post('/auth/register').send({
        email: 'refresh@example.com',
        password: 'RefreshP@ss123',
      })

      refreshToken = extractRefreshToken(response)
    })

    it('should refresh access token with valid refresh token', async () => {
      // Agent automatically sends cookies from register request
      const response = await agent.post('/auth/refresh').expect(200)

      expect(response.body).toMatchObject({
        accessToken: expect.any(String),
      })

      // Check new refresh token in cookie
      const newRefreshToken = extractRefreshToken(response)
      expect(newRefreshToken).toBeDefined()
      expect(newRefreshToken).not.toBe(refreshToken) // Token rotated
    })

    it('should return 401 for invalid refresh token', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', 'refresh_token=invalid-token')
        .expect(401)

      expect(response.body.message).toBeDefined()
    })

    it('should return 401 without refresh token', async () => {
      const response = await request(app.getHttpServer()).post('/auth/refresh').expect(401)

      expect(response.body.message).toBeDefined()
    })

    it('should rotate refresh token in database', async () => {
      const sessionsBefore = await prisma.session.findMany()
      const oldTokenHash = sessionsBefore[0]!.refreshToken

      // Agent automatically sends cookies from register request
      await agent.post('/auth/refresh').expect(200)

      const sessionsAfter = await prisma.session.findMany()
      expect(sessionsAfter).toHaveLength(1)
      expect(sessionsAfter[0]!.refreshToken).not.toBe(oldTokenHash)
    })
  })

  describe('GET /auth/me', () => {
    let accessToken: string

    beforeEach(async () => {
      const response = await request(app.getHttpServer()).post('/auth/register').send({
        email: 'me@example.com',
        password: 'MeP@ss123',
        name: 'Me User',
      })

      accessToken = response.body.accessToken
    })

    it('should return current user profile', async () => {
      const response = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      expect(response.body.user).toMatchObject({
        email: 'me@example.com',
        name: 'Me User',
        emailVerified: false,
      })
      expect(response.body.user.passwordHash).toBeUndefined()
    })

    it('should return 401 without access token', async () => {
      const response = await request(app.getHttpServer()).get('/auth/me').expect(401)

      expect(response.body.message).toBeDefined()
    })

    it('should return 401 with invalid access token', async () => {
      const response = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401)

      expect(response.body.message).toBeDefined()
    })
  })

  describe('GET /auth/sessions', () => {
    let agent: ReturnType<typeof request.agent>
    let accessToken: string

    beforeEach(async () => {
      agent = request.agent(app.getHttpServer())

      const response = await agent.post('/auth/register').send({
        email: 'sessions@example.com',
        password: 'SessionsP@ss123',
      })

      accessToken = response.body.accessToken
    })

    it('should return all user sessions', async () => {
      const response = await agent
        .get('/auth/sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      expect(response.body.sessions).toHaveLength(1)
      expect(response.body.sessions[0]).toMatchObject({
        id: expect.any(String),
        current: true,
      })
    })

    it('should mark current session correctly', async () => {
      // Create second session via login (using new agent to simulate different device)
      await request(app.getHttpServer()).post('/auth/login').send({
        email: 'sessions@example.com',
        password: 'SessionsP@ss123',
      })

      const response = await agent
        .get('/auth/sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      expect(response.body.sessions).toHaveLength(2)
      const currentSessions = response.body.sessions.filter((s: { current: boolean }) => s.current)
      expect(currentSessions).toHaveLength(1)
    })
  })

  describe('DELETE /auth/sessions/:sessionId', () => {
    let accessToken: string
    let sessionId: string

    beforeEach(async () => {
      const response = await request(app.getHttpServer()).post('/auth/register').send({
        email: 'delete@example.com',
        password: 'DeleteP@ss123',
      })

      accessToken = response.body.accessToken

      const sessions = await prisma.session.findMany()
      sessionId = sessions[0]!.id
    })

    it('should delete specific session', async () => {
      const response = await request(app.getHttpServer())
        .delete(`/auth/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      expect(response.body.message).toBeDefined()

      const sessions = await prisma.session.findMany()
      expect(sessions).toHaveLength(0)
    })

    it('should return 404 for non-existent session', async () => {
      const response = await request(app.getHttpServer())
        .delete('/auth/sessions/nonexistent-id')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404)

      expect(response.body.message).toBeDefined()
    })
  })

  describe('DELETE /auth/sessions', () => {
    let agent: ReturnType<typeof request.agent>
    let accessToken: string

    beforeEach(async () => {
      agent = request.agent(app.getHttpServer())

      const registerResponse = await agent.post('/auth/register').send({
        email: 'deleteall@example.com',
        password: 'DeleteAllP@ss123',
      })

      accessToken = registerResponse.body.accessToken

      // Create second session (using new agent to simulate different device)
      await request(app.getHttpServer()).post('/auth/login').send({
        email: 'deleteall@example.com',
        password: 'DeleteAllP@ss123',
      })
    })

    it('should delete all sessions except current', async () => {
      const response = await agent
        .delete('/auth/sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      expect(response.body.message).toBeDefined()

      const sessions = await prisma.session.findMany()
      expect(sessions).toHaveLength(1) // Current session remains
    })

    it('should return message if no refresh token', async () => {
      const response = await request(app.getHttpServer())
        .delete('/auth/sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      expect(response.body.message).toContain('Нет активной сессии')
    })
  })

  describe('Full Authentication Flow', () => {
    it('should complete: register → me → refresh → logout', async () => {
      // Create agent to persist cookies throughout the flow
      const agent = request.agent(app.getHttpServer())

      // 1. Register (user is now authenticated)
      const registerRes = await agent
        .post('/auth/register')
        .send({
          email: 'flow@example.com',
          password: 'FlowP@ss123',
          name: 'Flow User',
        })
        .expect(201)

      expect(registerRes.body.user.email).toBe('flow@example.com')
      const accessToken = registerRes.body.accessToken

      // 2. Get profile
      const meRes = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      expect(meRes.body.user.name).toBe('Flow User')

      // 3. Refresh token (agent automatically sends cookie from register)
      const refreshRes = await agent.post('/auth/refresh').expect(200)

      expect(refreshRes.body.accessToken).toBeDefined()

      // 4. Logout (agent automatically sends updated cookie from refresh)
      const logoutRes = await agent.post('/auth/logout').expect(200)

      expect(logoutRes.body.message).toContain('вышли')

      // Verify session deleted
      const sessions = await prisma.session.findMany()
      expect(sessions).toHaveLength(0)
    })
  })
})
