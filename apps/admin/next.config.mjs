/** @type {import('next').NextConfig} */
const nextConfig = {
  // Admin hosts dev scenes (OverlayEditor, Inspector) via next/dynamic. These
  // pull @alostraques/game for shared data/config/systems — webpack needs
  // the transpile hint for the workspace package + the pure sim dep.
  transpilePackages: ['@alostraques/game', '@alostraques/sim'],

  // Game assets live in apps/web/public/. `BootScene.setBaseURL('/')` issues
  // the preloads as `/assets/...`, which on admin's origin otherwise 404s.
  // Proxy them to the web app instead of duplicating ~100MB of sprites +
  // audio into apps/admin/public/. RFC 0019 §13 flags this: "admin proxies
  // web in dev", production points at the player origin (admin runs on its
  // own subdomain so this is cross-origin but Next handles the fetch
  // server-side so there's no CORS burden on the browser).
  async rewrites() {
    const assetOrigin =
      process.env.NEXT_PUBLIC_ASSET_ORIGIN ||
      (process.env.NODE_ENV === 'production'
        ? 'https://alostraques.com'
        : 'http://localhost:3000');
    return [
      {
        source: '/assets/:path*',
        destination: `${assetOrigin}/assets/:path*`,
      },
    ];
  },

  experimental: {},
};

export default nextConfig;
