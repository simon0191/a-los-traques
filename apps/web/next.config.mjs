/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile workspace packages so Next's webpack pipeline resolves Phaser's
  // ESM/CJS interop correctly (`import Phaser from 'phaser'` otherwise fails).
  transpilePackages: ['@alostraques/game', '@alostraques/sim'],
  experimental: {},
  // Allow the Vite app (localhost:5173) to call /api/* endpoints during local dev.
  async headers() {
    if (process.env.NODE_ENV === 'production') return [];
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, X-Dev-User-Id',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
