import { types } from 'node:util'
import { constants as compressionConstants } from 'node:zlib'

import { HttpException } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { ErrorRequestHandler } from 'express'

import { MEMBER_REQUEST_BYTES, ROLE_REQUEST_BYTES, WORK_COMMAND_INPUT_BYTES } from '@amcore/shared'

import {
  configureInvitationBoundary,
  invitationJsonLimit,
} from '../../src/bootstrap/invitation-request-boundary'
import { isMemberRoleJsonRequest } from '../../src/bootstrap/member-role-body-parser'
import { parserContentType } from '../../src/bootstrap/parser-content-type'
import {
  isBackgroundControlPath,
  REQUEST_BODY_LIMIT_BYTES,
} from '../../src/bootstrap/request-body-policy'
import {
  isRoleDefinitionFormRequest,
  isRoleDefinitionJsonRequest,
} from '../../src/bootstrap/role-definition-body-parser'

/**
 * Register explicit JSON and urlencoded body-parser limits on the application.
 *
 * The app MUST be created with `{ rawBody: true }`. `useBodyParser` re-registers
 * each parser while preserving Nest's raw-body capture: `req.rawBody` is the
 * decoded (post-inflation) body buffer body-parser hands to its `verify` hook,
 * which is exactly what the webhook verifier hashes — re-registering with an
 * explicit limit does not change those bytes. Only Express comparison fixtures call this helper. Production and API E2E
 * use the Fastify bootstrap instead; this is a maintained test control.
 */
export function configureBodyParser(app: NestExpressApplication, prefix = '/api/v1'): void {
  configureInvitationBoundary(app, prefix)
  app.use(
    (
      req: import('express').Request,
      res: import('express').Response,
      next: import('express').NextFunction
    ) => {
      try {
        if (req.headers['content-type']) {
          const media = parserContentType(req.headers['content-type'])
          if (
            ['application/json', 'application/x-www-form-urlencoded'].includes(media.type) &&
            media.parameters.charset === ''
          )
            return next(new HttpException('Unsupported content charset', 415))
        }
        const encoding = req.headers['content-encoding']?.trim().toLowerCase()
        if (encoding && !['identity', 'gzip', 'deflate', 'br'].includes(encoding)) {
          res.setHeader('Accept-Encoding', 'identity, gzip, deflate, br')
          return next(new HttpException('Unsupported content encoding', 415))
        }
        if (encoding) req.headers['content-encoding'] = encoding
        next()
      } catch (error) {
        next(error)
      }
    }
  )

  for (const limit of [2048, 16384])
    app.useBodyParser('json', {
      limit,
      type: (req) => {
        const type = req.headers['content-type']
        return (
          typeof type === 'string' &&
          /^application\/json(?:\s*;|$)/i.test(type) &&
          invitationJsonLimit(req.url ?? '', prefix) === limit
        )
      },
    })
  app.useBodyParser('json', {
    limit: MEMBER_REQUEST_BYTES,
    type: (req) => isMemberRoleJsonRequest(req, prefix),
  })
  app.useBodyParser('json', {
    limit: ROLE_REQUEST_BYTES,
    type: (req) => isRoleDefinitionJsonRequest(req, prefix),
  })
  app.useBodyParser('urlencoded', {
    limit: ROLE_REQUEST_BYTES,
    extended: true,
    type: (req) => isRoleDefinitionFormRequest(req, prefix),
  })
  app.useBodyParser('json', {
    limit: WORK_COMMAND_INPUT_BYTES,
    type: (req) =>
      req.method === 'POST' &&
      isBackgroundControlPath(req.url ?? '', prefix) &&
      /^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''),
  })
  // Even an invalid form command is rejected within the same decoded-byte
  // ceiling, before the generic form parser could allocate its larger body.
  app.useBodyParser('urlencoded', {
    limit: WORK_COMMAND_INPUT_BYTES,
    extended: false,
    type: (req) =>
      req.method === 'POST' &&
      isBackgroundControlPath(req.url ?? '', prefix) &&
      /^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''),
  })
  app.useBodyParser('json', { limit: REQUEST_BODY_LIMIT_BYTES })
  app.useBodyParser('urlencoded', { limit: REQUEST_BODY_LIMIT_BYTES, extended: true })
  // This middleware sees errors from the preceding body parsers, before controller routes.
  const brotliFormatErrors = new Set(
    Object.keys(compressionConstants)
      .filter((key) => key.startsWith('BROTLI_DECODER_ERROR_FORMAT_'))
      .map((key) => `ERR_${key.slice('BROTLI_DECODER'.length)}`)
  )
  const parserErrors: ErrorRequestHandler = (error, req, _res, next) => {
    if (
      types.isNativeError(error) &&
      (error as { status?: number }).status === 400 &&
      (error as { type?: string }).type === 'entity.parse.failed'
    )
      return next(new HttpException('Invalid request body', 400))
    if (
      error?.status === 400 &&
      (['Z_DATA_ERROR', 'Z_BUF_ERROR'].includes(error?.code) ||
        (req.headers['content-encoding'] === 'br' && brotliFormatErrors.has(error?.code)))
    )
      return next(new HttpException('Invalid compressed body', 400))
    next(error)
  }
  app.use(parserErrors)
}
