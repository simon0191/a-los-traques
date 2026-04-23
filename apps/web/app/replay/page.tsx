import type { Metadata } from 'next';
import { ReplayClient } from './ReplayClient';

export const metadata: Metadata = {
  title: 'Replay — A Los Traques',
};

export default function ReplayPage() {
  return <ReplayClient />;
}
