import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'A Los Traques — Admin',
  description: 'Admin console for A Los Traques.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <div id="app">{children}</div>
      </body>
    </html>
  );
}
