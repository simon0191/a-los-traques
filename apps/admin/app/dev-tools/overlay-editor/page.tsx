import type { Metadata } from 'next';
import { DevToolsHostClient } from './DevToolsHostClient';

export const metadata: Metadata = {
  title: 'Overlay Editor — Admin',
};

export default function OverlayEditorPage() {
  return <DevToolsHostClient entry="OverlayEditorScene" />;
}
