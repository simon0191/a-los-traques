import type { ReactNode } from 'react';
import { AuthedShell } from '@/components/AuthedShell';

export default function AuthedLayout({ children }: { children: ReactNode }) {
  return <AuthedShell>{children}</AuthedShell>;
}
