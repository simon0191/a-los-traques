'use client';

import dynamic from 'next/dynamic';

export const DevToolsHostClient = dynamic(
  () => import('@/components/DevToolsHost').then((m) => ({ default: m.DevToolsHost })),
  { ssr: false },
);
