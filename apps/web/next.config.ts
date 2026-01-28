import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // React Compiler (stable in Next.js 16)
  reactCompiler: true,

  // API proxy to backend
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL || 'http://localhost:5002'}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
