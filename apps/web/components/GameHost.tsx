'use client';

import { useEffect, useRef } from 'react';
import { ViewportFix } from './ViewportFix';

type PublicConfig = {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
};

type GameHostProps = {
  partyKitHost: string;
  isDev: boolean;
};

/**
 * Client-only wrapper that instantiates the Phaser game via
 * `@alostraques/game`'s `createGame` factory. Dynamic-imports the package so
 * Phaser's `window` access never reaches the server bundle.
 *
 * The game is boot-once: Phaser owns the canvas and a bunch of globals, so we
 * don't want a prop change to tear it down mid-match. Props are read through
 * a ref so the effect can stay dependency-free while still seeing current values.
 */
export function GameHost({ partyKitHost, isDev }: GameHostProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const envRef = useRef({ partyKitHost, isDev });
  envRef.current = { partyKitHost, isDev };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let game: { destroy?: (removeCanvas: boolean) => void } | null = null;

    (async () => {
      // Fetch runtime env the game needs from `/api/public-config` — same contract
      // the old Vite app consumed. Guest mode is fine when this returns nulls.
      let publicConfig: PublicConfig = { supabaseUrl: null, supabaseAnonKey: null };
      try {
        const res = await fetch('/api/public-config');
        if (res.ok) publicConfig = (await res.json()) as PublicConfig;
      } catch {
        // non-fatal — guest mode
      }
      if (disposed) return;

      const mod = await import('@alostraques/game');
      if (disposed) return;

      const { partyKitHost: pkHost, isDev: devMode } = envRef.current;
      game = mod.createGame({
        parent: container,
        params: new URLSearchParams(window.location.search),
        env: {
          partyKitHost: pkHost,
          supabaseUrl: publicConfig.supabaseUrl,
          supabaseAnonKey: publicConfig.supabaseAnonKey,
          isDev: devMode,
        },
      });
    })().catch((err) => {
      console.error('[GameHost] Failed to start game:', err);
    });

    return () => {
      disposed = true;
      try {
        game?.destroy?.(true);
      } catch {
        // Phaser can throw if it wasn't fully booted yet — safe to ignore.
      }
    };
  }, []);

  return (
    <>
      <ViewportFix />
      <div
        id="game-container"
        ref={containerRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100dvh',
        }}
      />
    </>
  );
}
