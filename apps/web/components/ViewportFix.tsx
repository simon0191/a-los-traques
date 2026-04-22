'use client';

import { useEffect } from 'react';

/**
 * Keeps `#game-container` sized to the visual viewport and pokes Phaser's scale
 * manager when the keyboard / URL bar opens or closes on mobile Safari.
 * Only runs on pages that embed the game — the marketing layout stays out of
 * this so it doesn't fight with normal document flow.
 */
export function ViewportFix() {
  useEffect(() => {
    const container = document.getElementById('game-container');
    if (!container) return;

    const fixHeight = () => {
      const w = globalThis as unknown as {
        _suppressFixHeight?: boolean;
        game?: { scale?: { refresh?: () => void } };
      };
      if (w._suppressFixHeight) return;
      const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
      container.style.width = `${vw}px`;
      container.style.height = `${vh}px`;
      w.game?.scale?.refresh?.();
    };

    fixHeight();
    window.addEventListener('resize', fixHeight);
    window.visualViewport?.addEventListener('resize', fixHeight);

    return () => {
      window.removeEventListener('resize', fixHeight);
      window.visualViewport?.removeEventListener('resize', fixHeight);
    };
  }, []);

  return null;
}
