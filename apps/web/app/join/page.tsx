import type { Metadata } from 'next';
import { Suspense } from 'react';
import { JoinClient } from './JoinClient';

export const metadata: Metadata = {
  title: 'Unirse al Torneo — A Los Traques',
};

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <JoinClient />
    </Suspense>
  );
}
