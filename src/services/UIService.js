/**
 * Shared UI utility to reduce code duplication across scenes.
 */

/**
 * Creates a standard styled button.
 * @param {Phaser.Scene} scene - The scene to add the button to.
 * @param {number} x - X position.
 * @param {number} y - Y position.
 * @param {string} label - Button text.
 * @param {Function} callback - Click handler.
 * @param {Object} options - Customization options.
 * @returns {Object} { bg, text }
 */
export function createButton(scene, x, y, label, callback, options = {}) {
  const width = options.width || 140;
  const height = options.height || 24;
  const fontSize = options.fontSize || '12px';
  const bgColor = options.bgColor || 0x222244;
  const strokeColor = options.strokeColor || 0x4444aa;
  const hoverColor = options.hoverColor || 0x333366;
  const textColor = options.textColor || '#ffffff';
  const hoverTextColor = options.hoverTextColor || '#ffcc00';

  const bg = scene.add
    .rectangle(x, y, width, height, bgColor)
    .setStrokeStyle(1, strokeColor)
    .setInteractive({ useHandCursor: true });

  const text = scene.add
    .text(x, y, label, {
      fontFamily: options.fontFamily || 'Arial',
      fontSize: fontSize,
      color: textColor,
    })
    .setOrigin(0.5);

  bg.on('pointerover', () => {
    bg.setFillStyle(hoverColor);
    text.setColor(hoverTextColor);
  });

  bg.on('pointerout', () => {
    bg.setFillStyle(bgColor);
    text.setColor(textColor);
  });

  bg.on('pointerdown', () => {
    if (scene.game.audioManager) {
      scene.game.audioManager.play('ui_confirm');
    }
    callback();
  });

  return { bg, text };
}
