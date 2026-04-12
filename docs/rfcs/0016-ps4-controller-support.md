# RFC 0016: PS4 Controller Support

## 1. Context
The game currently supports Keyboard and Touch inputs for combat and navigation, orchestrated by the `InputManager.js` component. To provide a true fighting game experience, particularly for local multiplayer, we need to introduce Gamepad support, specifically targeting PS4 controllers (DualShock 4 / DualSense) connected to a PC.

## 2. Problem Statement
Currently, `InputManager.js` hardcodes Keyboard (Z, X, A, S, D, Space, and Arrow Keys) and Touch overlay checks. Players connecting a gamepad cannot interact with the UI or control their fighters in combat. Without native Phaser Gamepad integration, local multiplayer is limited to both players crowding around a single keyboard or using touch overlays.

## 3. Proposed Solution
Integrate Phaser's native Gamepad plugin and update `InputManager` to read controller inputs alongside Keyboard and Touch inputs. Furthermore, implement a global `ControllerScene` to manage gamepad connection status and broadcast UI events for menu navigation.

### Key Strategies:
1. **Enable Gamepad Plugin:** Modify the Phaser game configuration in `src/main.js` to enable the Gamepad plugin (`input: { gamepad: true }`).
2. **Update `InputManager`:** Extend the getters (`left`, `right`, `lightPunch`, etc.) to query connected gamepads.
3. **Global `ControllerScene`:** Create a persistent background scene that listens for connection events and translates Gamepad D-Pad/Axis movements into global `ui_up`, `ui_down`, `ui_left`, `ui_right`, `ui_confirm`, and `ui_cancel` events.
4. **Toast Notifications:** Display a "Control conectado" or "Control desconectado" toast when a gamepad status changes.
5. **Standardized Mapping (PS4 Layout):**
    - **Movement:** D-Pad (Up, Down, Left, Right) or Left Analog Stick.
    - **Light Punch / Confirm:** Square (Button 2) / Cross (Button 0).
    - **Heavy Punch:** Triangle (Button 3).
    - **Light Kick:** Cross (Button 0).
    - **Heavy Kick:** Circle (Button 1).
    - **Special:** R1 / R2 (Button 5 / Button 7).
    - **Back / Cancel:** Circle (Button 1) or Options (Button 9).
    - **Block:** Down direction (same as keyboard).

## 4. Implementation Details

### `src/scenes/ControllerScene.js`
A new persistent scene added to the game config. It handles:
- **Connection Toasts:** Animated UI container for "Control conectado".
- **Event Broadcasting:** Emits `this.game.events.emit('ui_up', ...)` etc. with built-in repeat delays.

### Menu Scene Integration
Scenes like `TitleScene`, `SelectScene`, `StageSelectScene`, `VictoryScene`, `LobbyScene`, `InspectorScene`, and `MusicScene` have been updated to:
- Bind to global UI events on `wake`/`create`.
- Unbind on `sleep`/`shutdown`.
- Update visual selection cursors based on gamepad navigation.

### `src/main.js`
Enable gamepads in the global Phaser configuration and register `ControllerScene`.

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