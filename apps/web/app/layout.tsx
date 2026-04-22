import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'A Los Traques',
  description:
    'Street Fighter-style fighting game starring 16 real friends. iPhone 15 landscape Safari target.',
};

export const viewport: Viewport = {
  themeColor: '#1a1a2e',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
