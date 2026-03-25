import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import { getSession, logIn, signUp } from '../services/supabase.js';

export class LoginScene extends Phaser.Scene {
  constructor() {
    super('LoginScene');
  }

  async create() {
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1e);

    this.add
      .text(GAME_WIDTH / 2, 40, 'A LOS TRAQUES', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '24px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(GAME_WIDTH / 2, 70, 'Comprobando sesión...', {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: '#aaaacc',
      })
      .setOrigin(0.5);

    // Check for existing session
    try {
      const session = await getSession();
      if (session) {
        this.statusText.setText(`Bienvenido, ${session.user.email}`);
        this.time.delayedCall(1000, () => this.scene.start('TitleScene'));
        return;
      }
    } catch (e) {
      console.error('Session check failed', e);
    }

    this.statusText.setText('Inicia sesión para guardar tus estadísticas');
    this._showLoginForm();
  }

  _showLoginForm() {
    const x = GAME_WIDTH / 2;
    const y = GAME_HEIGHT / 2 + 10;

    // We use a simple HTML form via Phaser DOM element
    // Style matches the game aesthetic
    const html = `
      <div style="color: white; font-family: Arial; font-size: 12px; display: flex; flex-direction: column; gap: 8px; width: 200px; background: #1a1a3a; padding: 15px; border: 1px solid #4444aa; border-radius: 5px;">
        <input type="email" id="email" placeholder="Email" style="padding: 5px; border-radius: 3px; border: 1px solid #444; background: #0a0a1a; color: white;">
        <input type="password" id="password" placeholder="Contraseña" style="padding: 5px; border-radius: 3px; border: 1px solid #444; background: #0a0a1a; color: white;">
        <div style="display: flex; gap: 5px; margin-top: 5px;">
          <button id="loginBtn" style="flex: 1; padding: 5px; background: #3366ff; color: white; border: none; border-radius: 3px; cursor: pointer;">ENTRAR</button>
          <button id="signupBtn" style="flex: 1; padding: 5px; background: #222244; color: white; border: 1px solid #4444aa; border-radius: 3px; cursor: pointer;">REGISTRO</button>
        </div>
        <button id="guestBtn" style="margin-top: 5px; padding: 5px; background: none; color: #aaaacc; border: 1px dashed #444; border-radius: 3px; cursor: pointer; font-size: 10px;">JUGAR COMO INVITADO</button>
      </div>
    `;

    const form = this.add.dom(x, y).createFromHTML(html);

    form.addListener('click');

    form.on('click', async (event) => {
      const email = form.getChildByID('email').value;
      const password = form.getChildByID('password').value;

      if (event.target.id === 'loginBtn') {
        if (!email || !password) return;
        this._setLoading(true);
        try {
          await logIn(email, password);
          this.scene.start('TitleScene');
        } catch (e) {
          this._setErrorMessage(e.message);
          this._setLoading(false);
        }
      } else if (event.target.id === 'signupBtn') {
        if (!email || !password) return;
        this._setLoading(true);
        try {
          await signUp(email, password);
          this._setErrorMessage('¡Registro éxito! Revisa tu email.');
          this._setLoading(false);
        } catch (e) {
          this._setErrorMessage(e.message);
          this._setLoading(false);
        }
      } else if (event.target.id === 'guestBtn') {
        this.scene.start('TitleScene');
      }
    });
  }

  _setLoading(isLoading) {
    if (isLoading) {
      this.statusText.setText('Conectando...').setColor('#ffcc00');
    } else {
      this.statusText.setText('A LOS TRAQUES').setColor('#aaaacc');
    }
  }

  _setErrorMessage(msg) {
    this.statusText.setText(msg).setColor('#ff4444');
  }
}
