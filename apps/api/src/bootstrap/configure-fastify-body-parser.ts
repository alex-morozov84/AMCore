import type { Server } from 'node:http'

import compress from '@fastify/compress'
import { HttpException } from '@nestjs/common'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { FastifyAdapter } from '@nestjs/platform-fastify'

import {
  MEMBER_KEY_REQUEST_BYTES,
  MEMBER_REQUEST_BYTES,
  ROLE_REQUEST_BYTES,
  WORK_COMMAND_INPUT_BYTES,
} from '@amcore/shared'

import { decodedBodyLimit } from './decoded-body-limit.js'
import { configureInvitationBoundary, invitationJsonLimit } from './invitation-request-boundary.js'
import { isMemberRoleJsonRequest } from './member-role-body-parser.js'
import { decodeBody, parseNativeForm } from './native-body-values.js'
import { parserContentType } from './parser-content-type.js'
import { isBackgroundControlPath, REQUEST_BODY_LIMIT_BYTES } from './request-body-policy.js'
import { isRoleDefinitionRequest } from './role-definition-body-parser.js'
import { unmatchedBodyLimit } from './unmatched-body-limit.js'

type BudgetRequest = { url: string; method: string; headers: Record<string, unknown> }

function bodyBudget(req: BudgetRequest, prefix: string): number {
  const path = req.url.split('?')[0]
  if (
    req.method === 'POST' &&
    path?.startsWith(`${prefix}/organizations/`) &&
    /\/members\/[^/]+\/api-keys\/(?:[^/]+\/revoke|revoke-all)$/.test(path)
  )
    return MEMBER_KEY_REQUEST_BYTES
  if (isMemberRoleJsonRequest(req, prefix)) return MEMBER_REQUEST_BYTES
  if (isRoleDefinitionRequest(req, prefix)) return ROLE_REQUEST_BYTES
  const json = /^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] ?? ''))
  const invitationLimit = json ? invitationJsonLimit(req.url, prefix) : null
  if (invitationLimit !== null) return invitationLimit
  if (req.method === 'POST' && isBackgroundControlPath(req.url, prefix))
    return WORK_COMMAND_INPUT_BYTES
  return REQUEST_BODY_LIMIT_BYTES
}

/** Production parser: decoded limits and raw-body capture, without response compression. */
export async function configureFastifyBodyParser(
  app: NestFastifyApplication,
  prefix = '/api/v1'
): Promise<void> {
  configureInvitationBoundary(app, prefix)
  const adapter = app.getHttpAdapter() as FastifyAdapter<Server>
  const instance = adapter.getInstance()
  await instance.register(compress, {
    globalCompression: false,
    requestEncodings: ['gzip', 'deflate', 'br', 'identity'],
    onInvalidRequestPayload: () =>
      Object.assign(new Error('Invalid compressed body'), {
        code: 'FST_CP_ERR_INVALID_CONTENT',
        statusCode: 400,
      }),
    onUnsupportedRequestEncoding: () => new HttpException('Unsupported content encoding', 415),
  })
  instance.addHook('preParsing', (req, reply, payload, done) => {
    try {
      const media = req.headers['content-type']
      if (media) parserContentType(media)
      const encoding = req.headers['content-encoding']?.trim().toLowerCase()
      if (encoding && !['identity', 'gzip', 'deflate', 'br'].includes(encoding)) {
        reply.header('Accept-Encoding', 'identity, gzip, deflate, br')
        return done(new HttpException('Unsupported content encoding', 415))
      }
      if (encoding) req.headers['content-encoding'] = encoding
      done(null, payload)
    } catch (error) {
      done(error as Error)
    }
  })
  instance.addHook('onRoute', (route) => {
    const limitHook: Exclude<NonNullable<typeof route.preParsing>, unknown[]> = (
      req,
      reply,
      payload,
      done
    ) => {
      const media = String(req.headers['content-type'] ?? '')
      if (!/^application\/(?:json|x-www-form-urlencoded)(?:\s*;|$)/i.test(media))
        return done(null, payload)
      const bounded = decodedBodyLimit(payload, bodyBudget(req, prefix))
      reply.raw.once('finish', () => payload.destroy())
      done(null, bounded)
    }
    const existing = route.preParsing
    route.preParsing = [
      ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
      limitHook,
    ]
  })
  // Unmatched routes have no route-level compression hook. Preserve their decoded budget too.
  instance.addHook('preParsing', (req, reply, payload, done) => {
    if (req.routeOptions.url) return done(null, payload)
    const media = String(req.headers['content-type'] ?? '')
    if (!/^application\/(?:json|x-www-form-urlencoded)(?:\s*;|$)/i.test(media))
      return done(null, payload)
    let bounded
    try {
      bounded = unmatchedBodyLimit(payload, req.headers['content-encoding'])
    } catch (error) {
      return done(error instanceof Error ? error : new Error('Invalid body'))
    }
    reply.raw.once('finish', () => payload.destroy())
    done(null, bounded)
  })
  instance.removeContentTypeParser('application/json')
  const secureJson = instance.getDefaultJsonParser('error', 'error')
  app.useBodyParser('application/json', { bodyLimit: MEMBER_REQUEST_BYTES }, (req, body, done) => {
    try {
      const { text } = decodeBody(body, String(req.headers['content-type']), true)
      if (!text.length)
        return done(
          null,
          req.headers['content-length'] === undefined &&
            req.headers['transfer-encoding'] === undefined
            ? undefined
            : {}
        )
      secureJson(req as Parameters<typeof secureJson>[0], text, (error, parsed) => {
        if (error || parsed === null || typeof parsed !== 'object')
          return done(new HttpException('Invalid JSON body', 400))
        done(null, parsed)
      })
    } catch (error) {
      done(error as Error)
    }
  })
  app.useBodyParser(
    'application/x-www-form-urlencoded',
    { bodyLimit: MEMBER_REQUEST_BYTES },
    (req, body, done) => {
      try {
        if (
          !body.length &&
          req.headers['content-length'] === undefined &&
          req.headers['transfer-encoding'] === undefined
        ) {
          decodeBody(body, String(req.headers['content-type']), false)
          return done(null, undefined)
        }
        const flat = req.method === 'POST' && isBackgroundControlPath(req.url, prefix)
        done(null, parseNativeForm(body, String(req.headers['content-type']), flat))
      } catch (error) {
        done(error as Error)
      }
    }
  )
}
