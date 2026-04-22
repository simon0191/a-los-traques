import type { Metadata, Viewport } from 'next';
import { IS_DEV, PARTYKIT_HOST } from '@/lib/env';
import { GameHostClient } from './GameHostClient';

export const metadata: Metadata = {
  title: 'Jugar — A Los Traques',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#000000',
};

export default function PlayPage() {
  return <GameHostClient partyKitHost={PARTYKIT_HOST} isDev={IS_DEV} />;
}
