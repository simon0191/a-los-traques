'use client';

import { useEffect, useRef } from 'react';

type DevToolsHostProps = {
  entry: 'OverlayEditorScene' | 'InspectorScene';
};

/**
 * Admin-side equivalent of apps/web's GameHost — boots a minimal Phaser game
 * with only the dev scenes registered. Dynamic-imports `apps/admin/game-tools`
 * so Phaser stays out of the server bundle.
 */
export function DevToolsHost({ entry }: DevToolsHostProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let game: { destroy?: (removeCanvas: boolean) => void } | null = null;

    (async () => {
      const mod = await import('@/game-tools');
      if (disposed) return;
      game = mod.createDevToolsGame({
        parent: container,
        entry,
        env: { isDev: process.env.NODE_ENV !== 'production' },
      });
    })().catch((err) => {
      console.error('[DevToolsHost] Failed to start dev tool:', err);
    });

    return () => {
      disposed = true;
      try {
        game?.destroy?.(true);
      } catch {
        // ignore — game may not have finished booting
      }
    };
  }, [entry]);

  return (
    <div
      id="game-container"
      ref={containerRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100dvh',
      }}
    />
  );
}
