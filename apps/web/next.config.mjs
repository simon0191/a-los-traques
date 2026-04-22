/** @type {import('next').NextConfig} */
const nextConfig = {
  // Silence the "experimental" turbopack banner in dev.
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
