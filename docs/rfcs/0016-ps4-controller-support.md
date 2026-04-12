# RFC 0016: PS4 Controller Support

## 1. Context
The game currently supports Keyboard and Touch inputs for combat and navigation, orchestrated by the `InputManager.js` component. To provide a true fighting game experience, particularly for local multiplayer, we need to introduce Gamepad support, specifically targeting PS4 controllers (DualShock 4 / DualSense) connected to a PC.

## 2. Problem Statement
Currently, `InputManager.js` hardcodes Keyboard (Z, X, A, S, D, Space, and Arrow Keys) and Touch overlay checks. Players connecting a gamepad cannot interact with the UI or control their fighters in combat. Without native Phaser Gamepad integration, local multiplayer is limited to both players crowding around a single keyboard or using touch overlays.

## 3. Proposed Solution
Integrate Phaser's native Gamepad plugin and implement a global `ControllerScene` that manages all UI menu navigation using a centralized **Explicit Array/Grid** registration method. This removes the need for manual input listeners in individual UI scenes.

### Key Strategies:
1. **Enable Gamepad Plugin:** Modify `src/main.js` to enable the Gamepad plugin.
2. **Centralized `ControllerScene`:** A persistent background scene that serves as the global navigator.
3. **Explicit Registration API:** Scenes register their interactive objects via `controller.setNavMenu(items, isGrid)`.
    - **1D Menus:** Vertical lists with automatic wrap-around.
    - **2D Grids:** Matrices for character/stage selection with boundary clamping.
4. **Global Visual Cursor:** A Graphics-based rectangle that smoothly **lerps** to the position and size of the currently focused item, providing consistent visual feedback across the entire game.
5. **Standardized Mapping (PS4 Layout):**
    - **Movement:** D-Pad or Left Analog Stick.
    - **Confirm:** Cross (Button 0) or Square (Button 2).
    - **Back / Cancel:** Circle (Button 1) or Options (Button 9).
    - **Notifications:** "Control conectado" toasts on status change.

## 4. Implementation Details

### `src/scenes/ControllerScene.js`
The "Global Brain" of the navigation system. It tracks the `focusedObject` and handles the input loop for both Gamepad and Keyboard. It uses `Phaser.Math.Linear` to animate the cursor movement between menu items.

### Scene Integration
Individual scenes are simplified. Instead of managing `selectedIndex` or listening for `keydown` events, they simply collect their buttons and register them:
```javascript
const buttons = [btn1, btn2, btn3];
this.scene.get('ControllerScene').setNavMenu(buttons);
```
This ensures that even complex scenes like `SelectScene` (Character Select) and `StageSelectScene` can leverage the centralized input handling while providing their own custom layouts.

### `src/systems/InputManager.js`
Refactor property getters to include gamepad checks. `InputManager` needs to identify which player (P1 or P2) it represents, or simply read from the assigned gamepad index.

Because `InputManager` is currently instantiated per player (or per scene), we should accept an optional `gamepadIndex` in the constructor.
```javascript
export class InputManager {
  constructor(scene, gamepadIndex = 0) {
    this.scene = scene;
    this.gamepadIndex = gamepadIndex;
    // ... existing keyboard & touch setup ...
  }

  _getGamepad() {
    if (!this.scene.input.gamepad) return null;
    return this.scene.input.gamepad.gamepads[this.gamepadIndex];
  }

  get left() {
    const pad = this._getGamepad();
    const padLeft = pad && (pad.left || (pad.axes[0] && pad.axes[0].getValue() < -0.5));
    return this.cursors.left.isDown || this.touchState.left || padLeft;
  }
  
  get lightPunch() {
    const pad = this._getGamepad();
    // Assuming Button 2 is Square on PS4
    const padPress = pad && pad.buttons[2] && pad.buttons[2].pressed; 
    return Phaser.Input.Keyboard.JustDown(this.keys.z) || this.touchState.lightPunch || padPress;
  }
  // ... apply similar logic to all getters
}
```

### Updating Consumers
Scenes instantiating `InputManager` (like `FightScene` or local multiplayer logic) need to pass the appropriate `gamepadIndex` (0 for Player 1, 1 for Player 2).

## 5. Verification Plan
- **Unit/Manual Tests:** Verify that connecting a PS4 controller allows character movement and attacks in `FightScene`.
- **Multi-device Testing:** Connect two PS4 controllers and verify that Player 1 and Player 2 can fight locally without input interference.
- **Regression:** Ensure Keyboard and Touch inputs remain fully functional alongside Gamepads.