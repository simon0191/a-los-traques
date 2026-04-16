import { GAME_WIDTH, MAX_HP, MAX_SPECIAL } from '../config.js';

const COMMANDS = {
  help: 'help | noai | ai | god | mortal | kill | hp [n] | sp [n] | timer [n] | speed [n] | pos | reset | fps | dev:tournament:join [id]',
};

export class DevConsole {
  constructor(scene) {
    this.scene = scene;
    this.visible = false;
    this.godMode = false;
    this.inputText = '';
    this.history = [];
    this.historyIndex = -1;
    this.log = [];

    // Container for all console visuals
    this.container = scene.add.container(0, 0).setDepth(200).setVisible(false);

    // Background
    this.bg = scene.add.rectangle(0, 0, GAME_WIDTH, 100, 0x000000, 0.85).setOrigin(0, 0);
    this.container.add(this.bg);

    // Log text
    this.logText = scene.add
      .text(6, 4, '', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#00ff00',
        wordWrap: { width: GAME_WIDTH - 12 },
      })
      .setOrigin(0, 0);
    this.container.add(this.logText);

    // Input line
    this.inputBg = scene.add.rectangle(0, 88, GAME_WIDTH, 12, 0x111111).setOrigin(0, 0);
    this.container.add(this.inputBg);

    this.inputDisplay = scene.add
      .text(6, 89, '> ', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#ffcc00',
      })
      .setOrigin(0, 0);
    this.container.add(this.inputDisplay);

    // Toggle with backtick key
    scene.input.keyboard.on('keydown', (e) => {
      if (e.key === '`' || e.key === '~') {
        e.preventDefault();
        this.toggle();
        return;
      }
      if (!this.visible) return;

      e.stopPropagation();

      if (e.key === 'Enter') {
        this.exec(this.inputText);
        this.inputText = '';
      } else if (e.key === 'Backspace') {
        this.inputText = this.inputText.slice(0, -1);
      } else if (e.key === 'ArrowUp') {
        if (this.history.length > 0) {
          this.historyIndex = Math.min(this.historyIndex + 1, this.history.length - 1);
          this.inputText = this.history[this.historyIndex];
        }
      } else if (e.key === 'ArrowDown') {
        this.historyIndex = Math.max(this.historyIndex - 1, -1);
        this.inputText = this.historyIndex >= 0 ? this.history[this.historyIndex] : '';
      } else if (e.key === 'Escape') {
        this.toggle();
      } else if (e.key.length === 1) {
        this.inputText += e.key;
      }

      this.inputDisplay.setText(`> ${this.inputText}_`);
    });

    this.print('Dev console ready. Type "help" for commands.');
  }

  toggle() {
    this.visible = !this.visible;
    this.container.setVisible(this.visible);
  }

  print(msg) {
    this.log.push(msg);
    if (this.log.length > 8) this.log.shift();
    this.logText.setText(this.log.join('\n'));
  }

  exec(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return;

    this.history.unshift(trimmed);
    if (this.history.length > 20) this.history.pop();
    this.historyIndex = -1;

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = parts[1];
    const scene = this.scene;

    switch (cmd) {
      case 'help':
        this.print(COMMANDS.help);
        break;

      case 'noai':
        if (scene.aiController) {
          scene.aiController.destroy();
          scene.aiController = null;
          scene.p2Fighter.stop();
          this.print('AI disabled. P2 is idle.');
        } else {
          this.print('AI already off.');
        }
        break;

      case 'ai': {
        const diff = arg || 'medium';
        if (!scene.aiController) {
          const { AIController } = require('../systems/AIController.js');
          scene.aiController = new AIController(scene, scene.p2Fighter, scene.p1Fighter, diff);
          this.print(`AI enabled (${diff}).`);
        } else {
          this.print('AI already running.');
        }
        break;
      }

      case 'god':
        this.godMode = true;
        this.print('God mode ON. P1 takes no damage.');
        break;

      case 'mortal':
        this.godMode = false;
        this.print('God mode OFF.');
        break;

      case 'kill':
        scene.p2Fighter.hp = 0;
        scene.combat.handleKO(scene.p1Fighter, scene.p2Fighter);
        this.print('P2 KO.');
        break;

      case 'hp': {
        const val = parseInt(arg, 10);
        if (!Number.isNaN(val)) {
          scene.p1Fighter.hp = Phaser.Math.Clamp(val, 0, MAX_HP);
          scene.p2Fighter.hp = Phaser.Math.Clamp(val, 0, MAX_HP);
          this.print(`Both HP set to ${val}.`);
        } else {
          this.print(`P1: ${scene.p1Fighter.hp} | P2: ${scene.p2Fighter.hp}`);
        }
        break;
      }

      case 'sp': {
        const val = parseInt(arg, 10);
        if (!Number.isNaN(val)) {
          scene.p1Fighter.special = Phaser.Math.Clamp(val, 0, MAX_SPECIAL);
          this.print(`P1 special set to ${val}.`);
        } else {
          this.print(`P1: ${scene.p1Fighter.special} | P2: ${scene.p2Fighter.special}`);
        }
        break;
      }

      case 'timer': {
        const val = parseInt(arg, 10);
        if (!Number.isNaN(val)) {
          scene.combat.timer = val;
          this.print(`Timer set to ${val}.`);
        } else {
          this.print(`Timer: ${scene.combat.timer}`);
        }
        break;
      }

      case 'speed': {
        const val = parseInt(arg, 10);
        if (!Number.isNaN(val)) {
          scene.p1Fighter.data.stats.speed = Phaser.Math.Clamp(val, 1, 10);
          this.print(`P1 speed stat set to ${val}.`);
        } else {
          this.print(`P1 speed: ${scene.p1Fighter.data.stats.speed}`);
        }
        break;
      }

      case 'pos':
        this.print(
          `P1: (${Math.round(scene.p1Fighter.sprite.x)}, ${Math.round(scene.p1Fighter.sprite.y)}) | P2: (${Math.round(scene.p2Fighter.sprite.x)}, ${Math.round(scene.p2Fighter.sprite.y)})`,
        );
        break;

      case 'reset':
        scene.p1Fighter.reset(GAME_WIDTH * 0.3);
        scene.p2Fighter.reset(GAME_WIDTH * 0.7);
        scene.combat.timer = 60;
        scene.combat.roundActive = true;
        this.print('Fighters and timer reset.');
        break;

      case 'fps':
        this.print(`FPS: ${Math.round(scene.game.loop.actualFps)}`);
        break;

      case 'dev:tournament:join': {
        if (scene.scene.key !== 'TournamentSetupScene') {
          this.print('Command only available in TournamentSetupScene.');
          break;
        }
        const playerId = arg || Math.random().toString(36).substring(2, 6);
        const name = `DEV-${playerId.toUpperCase()}`;

        const lobby = scene.lobby;
        if (!lobby) {
          this.print('Lobby service not found.');
          break;
        }

        const emptyIdx = lobby.state.slots.indexOf(null);
        if (emptyIdx === -1) {
          this.print('Lobby is full.');
          break;
        }

        lobby.state.slots[emptyIdx] = {
          type: 'human',
          id: `dev-${playerId}`,
          name: name,
          status: 'ready',
        };
        lobby._broadcast();
        this.print(`Joined as ${name} to slot ${emptyIdx + 1}.`);
        break;
      }

      default:
        this.print(`Unknown: "${cmd}". Type "help".`);
    }
  }
}

// Lazy import for AIController to avoid circular deps
function require(_path) {
  return { AIController: DevConsole._AIController };
}
DevConsole._AIController = null;
