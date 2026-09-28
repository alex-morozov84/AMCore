export function mockEnvironment(m) {
  return {
    NODE_ENV: 'development',
    PLAYWRIGHT_TEST_PROXY: 'true',
    API_URL: 'http://api.mocked.invalid',
    REDIS_URL: 'redis://redis.mocked.invalid:6379',
    WEB_TRUSTED_ORIGINS: m.origins.product,
    NEXT_PUBLIC_API_URL: m.origins.product,
    FRONTEND_URL: m.origins.product,
    // AMCORE_CONSOLE_MOCK_ENV_START
    ADMIN_CONSOLE_HOSTNAME: m.topology === 'host' ? m.hostnames.console : '',
    ADMIN_CONSOLE_ORIGIN:
      m.topology === 'host' ? `https://${m.hostnames.console}:${m.ports.tls}` : '',
    // AMCORE_CONSOLE_MOCK_ENV_END
  }
}
