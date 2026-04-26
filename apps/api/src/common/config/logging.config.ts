import { RequestMethod } from '@nestjs/common'
import type { ClsService } from 'nestjs-cls'
import type { Params } from 'nestjs-pino'
import { hostname } from 'os'

/**
 * Pino logging configuration for nestjs-pino
 * Includes: correlation ID, sensitive data redaction, request/response serializers, GDPR-compliant IP anonymization
 */
export function createLoggingConfig(cls: ClsService): Params {
  const isDevelopment = process.env.NODE_ENV !== 'production'

  return {
    pinoHttp: {
      // Mixin applies to ALL logs (including manual logger.warn/error calls in exception filters)
      mixin() {
        return {
          correlationId: cls.getId(),
        }
      },

      // Pretty console output in development
      transport: isDevelopment
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              singleLine: true,
              ignore: 'pid,hostname',
            },
          }
        : undefined,

      level: isDevelopment ? 'debug' : 'info',
      autoLogging: true,
      quietReqLogger: true,

      // Sensitive data redaction (GDPR compliant)
      redact: {
        paths: [
          // Passwords
          'req.body.password',
          'req.body.currentPassword',
          'req.body.newPassword',
          'req.body.confirmPassword',
          'req.body.oldPassword',
          'req.body.user.password',
          'req.body.user.currentPassword',
          'req.body.user.newPassword',
          'req.body.user.confirmPassword',
          'req.body.user.oldPassword',
          '*.password',
          '*.currentPassword',
          '*.newPassword',

          // Tokens & Secrets
          'req.body.token',
          'req.body.accessToken',
          'req.body.refreshToken',
          'req.body.apiKey',
          'req.body.secret',
          'req.body.user.token',
          'req.body.user.accessToken',
          'req.body.user.refreshToken',
          'req.body.user.apiKey',
          'req.body.user.secret',
          'req.body.session.token',
          'req.body.session.accessToken',
          'req.body.session.refreshToken',
          'req.body.session.secret',
          'req.body.apiKey.token',
          'req.body.apiKey.accessToken',
          'req.body.apiKey.refreshToken',
          'req.body.apiKey.secret',
          'req.body.oauthAccount.accessToken',
          'req.body.oauthAccount.refreshToken',
          'req.query.token',
          'req.query.apiKey',
          '*.token',
          '*.accessToken',
          '*.refreshToken',
          '*.apiKey',
          '*.secret',
          '*.passwordHash',
          '*.tokenHash',
          '*.keyHash',
          '*.salt',

          // Known nested hashes / credentials
          'req.body.user.passwordHash',
          'req.body.user.tokenHash',
          'req.body.user.keyHash',
          'req.body.user.salt',
          'req.body.session.passwordHash',
          'req.body.session.tokenHash',
          'req.body.session.keyHash',
          'req.body.session.salt',
          'req.body.apiKey.passwordHash',
          'req.body.apiKey.tokenHash',
          'req.body.apiKey.keyHash',
          'req.body.apiKey.salt',
          'req.body.oauthAccount.passwordHash',
          'req.body.oauthAccount.tokenHash',
          'req.body.oauthAccount.keyHash',
          'req.body.oauthAccount.salt',

          // Headers
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'req.headers["x-auth-token"]',

          // Response tokens
          'res.body.accessToken',
          'res.body.refreshToken',

          // Payment data
          'req.body.creditCard',
          'req.body.cardNumber',
          'req.body.cvv',
          'req.body.payment.card',
          'req.body.payment.card.*',
          '*.creditCard',
          '*.cardNumber',
          '*.cvv',

          // Personal identifiers (optional - uncomment if needed)
          // 'req.body.ssn',
          // '*.ssn',
        ],
        censor: '[REDACTED]',
      },

      // Custom serializers to include request/response bodies (with redaction)
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url,
            query: req.query,
            params: req.params,
            headers: {
              host: req.headers.host,
              'user-agent': req.headers['user-agent'],
              'content-type': req.headers['content-type'],
              authorization: req.headers.authorization, // Will be redacted
              cookie: req.headers.cookie, // Will be redacted
            },
            body: req.raw?.body || req.body, // Include body from raw request (sensitive fields will be redacted)
            remoteAddress: req.socket?.remoteAddress,
            remotePort: req.socket?.remotePort,
          }
        },
        res(res) {
          return {
            statusCode: res.statusCode,
            headers: res.getHeaders?.() || res.headers,
          }
        },
      },

      // Note: correlationId is added via mixin above (applies to ALL logs)
      // Other fields (userId, ip, userAgent, nodeId) are added via customProps for HTTP logs only
      customProps: () => ({
        userId: cls.get('userId'),
        ip: cls.get('ip'), // Anonymized IP (GDPR compliant)
        userAgent: cls.get('userAgent'),
        nodeId: process.env.NODE_ID || hostname(), // For multi-node deployment
      }),
    },

    // Apply to all routes
    forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],

    // Exclude health check endpoints from logs to reduce noise
    exclude: [
      { path: 'api/v1/health', method: RequestMethod.GET },
      { path: 'api/v1/health/startup', method: RequestMethod.GET },
      { path: 'api/v1/health/ready', method: RequestMethod.GET },
      { path: 'api/v1/health/live', method: RequestMethod.GET },
    ],
  }
}
