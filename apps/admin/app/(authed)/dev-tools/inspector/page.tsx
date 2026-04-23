import type { Metadata } from 'next';
import { DevToolsHostClient } from '../overlay-editor/DevToolsHostClient';

export const metadata: Metadata = {
  title: 'Inspector — Admin',
};

export default function InspectorPage() {
  return (
    <div className="admin-canvas">
      <DevToolsHostClient entry="InspectorScene" />
    </div>
  );
}
