'use client';

import dynamic from 'next/dynamic';

// Phaser touches `window` at module load — keep it out of the server bundle.
export const GameHostClient = dynamic(
  () => import('@/components/GameHost').then((m) => ({ default: m.GameHost })),
  { ssr: false },
);
