import { createHmac } from 'node:crypto'

export function mockEnvironment(m) {
  return {
    ...(m.mockTls ? { NODE_EXTRA_CA_CERTS: `${m.mockTls.dir}/cert.pem` } : {}),
    ...(m.productAdminHost ? { PRODUCT_ADMIN_ORIGIN: m.origins.staff } : {}),
    NODE_ENV: 'development',
    PLAYWRIGHT_TEST_PROXY: 'true',
    API_URL: 'http://api.mocked.invalid',
    REDIS_URL: 'redis://redis.mocked.invalid:6379',
    WEB_TRUSTED_ORIGINS: Object.values(m.origins).join(','),
    WEB_INVITATION_LOCAL_HTTP_ORIGIN: m.origins.product.startsWith('http:')
      ? m.origins.product
      : '',
    NEXT_PUBLIC_API_URL: m.origins.product,
    FRONTEND_URL: m.origins.product,
    WEB_FRONTEND_CONTEXT_KEY: createHmac('sha256', m.jwtSecret)
      .update('amcore-web-context-v1')
      .digest('hex'),
    ADMIN_CONSOLE_HOSTNAME: m.topology === 'host' ? m.hostnames.console : '',
    ADMIN_CONSOLE_ORIGIN: m.origins.console ?? '',
  }
}
