import path from 'node:path'

import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  // Standalone output for Docker
  output: 'standalone',

  // Monorepo root for standalone file tracing — without it Next traces from
  // apps/web and omits the workspace `@amcore/shared` package and the hoisted
  // pnpm store, producing a standalone bundle that cannot resolve them.
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),

  // React Compiler (stable in Next.js 16)
  reactCompiler: true,

  // API proxy to backend
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL || 'http://localhost:5002'}/api/:path*`,
      },
    ]
  },

  // Headers for PWA service worker
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
        ],
      },
    ]
  },
}

export default withNextIntl(nextConfig)
