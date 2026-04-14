# RFC 0016: Comprehensive PS4 Controller Support & Centralized Navigation

## 1. Context
The game currently supports Keyboard and Touch inputs for combat and navigation. To provide a true fighting game experience, particularly for local multiplayer, we need to introduce native Gamepad support, specifically targeting PS4 controllers (DualShock 4 / DualSense) connected to a PC.

## 2. Problem Statement
Previously, `InputManager.js` hardcoded Keyboard and Touch overlay checks. This limited local multiplayer to a single keyboard and made menu navigation impossible without a mouse or touch device. Manual implementation of navigation in every scene was leading to code duplication and inconsistent behavior across different menus (Title, Select, Stage, etc.).

## 3. Proposed Solution
Implement a two-layered solution:
1.  **Low-Level Input Mapping**: Update `InputManager` to read native Phaser Gamepad inputs mapped to PS4 standards.
2.  **Centralized Navigation System**: A global `ControllerScene` that manages all UI menu navigation using an **Explicit Array/Grid** registration method, providing a polished and consistent user experience.

### Key Strategies:
-   **Direct Input Integration**: Enable Phaser's Gamepad plugin and map Square/Triangle to Punches, Cross/Circle to Kicks, and R1/R2 to Specials.
-   **Global Navigator (`ControllerScene`)**: A persistent background scene that serves as the "Global Brain" for menu interactions.
-   **Smooth Visual Feedback**: A glowing cursor that **lerps** (linearly interpolates) between focused items, snapping to their size and position.
-   **Scene Automation**: An API allowing scenes to register buttons as 1D arrays or 2D matrices, removing the need for manual `keydown` listeners in UI code.
-   **Intelligent Back/Cancel**: Global mapping of **Circle (O)** and **Options** to trigger the specific "Back" logic of the currently active scene.
-   **Automatic Lifecycle Management**: The system automatically detects gameplay transitions (e.g., entering `FightScene`) and clears the navigation state to prevent "ghost cursors" during combat.

## 4. Implementation Details

### `src/systems/InputManager.js`
Extended to support a `gamepadIndex` (supporting local PvP). It uses optional chaining and "Just Down" logic for reliable attack triggering.
-   **Movement**: D-Pad or Left Analog Stick (threshold > 0.5).
-   **Confirm/Light Punch**: Cross (Button 0) or Square (Button 2).
-   **Back/Light Kick**: Circle (Button 1) or Cross (Button 0) depending on context.

### `src/scenes/ControllerScene.js` (The Navigator)
This scene manages the registration and interaction loop:
-   **`setNavMenu(items, isGrid, showCursor)`**: Public API for scenes to register their interactables.
-   **`focusItem(obj)`**: Allows scenes to manually move the controller focus (e.g., snapping to the "LISTO" button after selecting a stage).
-   **Spacial Awareness**: 2D Grid navigation handles different row lengths and boundary clamping.
-   **Cursor Control**: Supports a `noCursor` property on individual GameObjects to hide the yellow square in specialized menus (like the character select grid) while maintaining input focus.

### `src/main.js`
Configured to ensure `ControllerScene` is the last scene in the array, guaranteeing it renders its navigation cursor on top of all other game elements.

## 5. Verification Plan
-   **Unit Tests**: Verified that `InputManager` and `NetworkFacade` (which interacts with slots) handle the new indices correctly.
-   **Manual Flow**: Confirmed a complete "hands-off-mouse" experience from Boot through Login, Menu navigation, Character/Stage selection, and Combat.
-   **Edge Cases**: Verified that disconnecting a controller mid-game triggers the "Control desconectado" notification and cleans up the UI correctly.

## 6. Conclusion
By centralizing navigation logic and standardizing PS4 input mapping, we have transformed the game from a keyboard-only experience into a console-quality fighting game. This architecture is future-proof, allowing any new menu scene to gain full controller support with just a single line of registration code.
