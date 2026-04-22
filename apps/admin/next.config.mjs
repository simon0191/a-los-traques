/** @type {import('next').NextConfig} */
const nextConfig = {
  // Admin hosts dev scenes (OverlayEditor, Inspector) via next/dynamic. These
  // pull @alostraques/game for shared data/config/systems — webpack needs
  // the transpile hint for the workspace package + the pure sim dep.
  transpilePackages: ['@alostraques/game', '@alostraques/sim'],
  experimental: {},
};

export default nextConfig;
