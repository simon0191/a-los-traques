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
        const name = session.user.user_metadata?.nickname || session.user.email;
        this.statusText.setText(`Bienvenido, ${name}`).setColor('#44cc88');
        // Update registry immediately to avoid race conditions in TitleScene
        this.game.registry.set('user', session.user);
        this.game.registry.set('session', session);

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
    if (this.form) this.form.destroy();

    const x = GAME_WIDTH / 2;
    const y = GAME_HEIGHT / 2 + 10;

    const html = `
      <div id="login-card" style="color: white; font-family: Arial; font-size: 12px; display: flex; flex-direction: column; gap: 8px; width: 200px; background: #1a1a3a; padding: 15px; border: 1px solid #4444aa; border-radius: 5px;">
        <input type="email" id="email" placeholder="Email" style="padding: 5px; border-radius: 3px; border: 1px solid #444; background: #0a0a1a; color: white;">
        <input type="password" id="password" placeholder="Contraseña" style="padding: 5px; border-radius: 3px; border: 1px solid #444; background: #0a0a1a; color: white;">
        <div style="display: flex; gap: 5px; margin-top: 5px;">
          <button id="loginBtn" style="flex: 1; padding: 5px; background: #3366ff; color: white; border: none; border-radius: 3px; cursor: pointer;">ENTRAR</button>
          <button id="showSignupBtn" style="flex: 1; padding: 5px; background: #222244; color: white; border: 1px solid #4444aa; border-radius: 3px; cursor: pointer;">REGISTRO</button>
        </div>
        <button id="guestBtn" style="margin-top: 5px; padding: 5px; background: none; color: #aaaacc; border: 1px dashed #444; border-radius: 3px; cursor: pointer; font-size: 10px;">JUGAR COMO INVITADO</button>
      </div>
    `;

    this.form = this.add.dom(x, y).createFromHTML(html);
    this.form.addListener('click');

    this.form.on('click', async (event) => {
      if (event.target.id === 'loginBtn') {
        const email = this.form.getChildByID('email').value;
        const password = this.form.getChildByID('password').value;
        if (!email || !password) {
          this._setErrorMessage('Introduce email y contraseña');
          return;
        }

        this._setLoading(true);
        try {
          const { session } = await logIn(email, password);
          if (session) {
            this.game.registry.set('user', session.user);
            this.game.registry.set('session', session);
          }
          this.scene.start('TitleScene');
        } catch (e) {
          this._setErrorMessage(e.message);
          this._setLoading(false);
        }
      } else if (event.target.id === 'showSignupBtn') {
        this._showSignupForm();
      } else if (event.target.id === 'guestBtn') {
        this.game.registry.set('user', null);
        this.game.registry.set('session', null);
        this.scene.start('TitleScene');
      }
    });
  }

  _showSignupForm() {
    if (this.form) this.form.destroy();

    const x = GAME_WIDTH / 2;
    const y = GAME_HEIGHT / 2 + 10;

    const html = `
      <div id="signup-card" style="color: white; font-family: Arial; font-size: 12px; display: flex; flex-direction: column; gap: 8px; width: 200px; background: #1a1a3a; padding: 15px; border: 1px solid #4444aa; border-radius: 5px;">
        <h3 style="margin: 0 0 5px 0; text-align: center; color: #ffcc00; font-size: 14px;">NUEVA CUENTA</h3>
        <input type="text" id="nickname" placeholder="Apodo (ej: Simo)" style="padding: 5px; border-radius: 3px; border: 1px solid #444; background: #0a0a1a; color: white;">
        <input type="email" id="email" placeholder="Email" style="padding: 5px; border-radius: 3px; border: 1px solid #444; background: #0a0a1a; color: white;">
        <input type="password" id="password" placeholder="Contraseña" style="padding: 5px; border-radius: 3px; border: 1px solid #444; background: #0a0a1a; color: white;">
        <input type="password" id="passwordVerify" placeholder="Repetir Contraseña" style="padding: 5px; border-radius: 3px; border: 1px solid #444; background: #0a0a1a; color: white;">
        
        <button id="signupBtn" style="margin-top: 5px; padding: 8px; background: #44cc88; color: white; border: none; border-radius: 3px; cursor: pointer; font-weight: bold;">CREAR CUENTA</button>
        <button id="backBtn" style="padding: 5px; background: none; color: #aaaacc; border: none; cursor: pointer; font-size: 10px;">VOLVER AL INICIO</button>
      </div>
    `;

    this.form = this.add.dom(x, y).createFromHTML(html);
    this.form.addListener('click');

    this.form.on('click', async (event) => {
      if (event.target.id === 'signupBtn') {
        const nickname = this.form.getChildByID('nickname').value;
        const email = this.form.getChildByID('email').value;
        const password = this.form.getChildByID('password').value;
        const passwordVerify = this.form.getChildByID('passwordVerify').value;

        if (!nickname || !email || !password) {
          this._setErrorMessage('Todos los campos son obligatorios');
          return;
        }

        if (password !== passwordVerify) {
          this._setErrorMessage('Las contraseñas no coinciden');
          return;
        }

        this._setLoading(true);
        try {
          await signUp(email, password, nickname);
          this._setErrorMessage('¡REGISTRO ÉXITO! Revisa tu email para verificar la cuenta.');
          this.statusText.setColor('#44cc88');
          // Give more time to read the message (10s) and show a "BACK" button
          if (this.form) {
            const signupCard = this.form.getChildByID('signup-card');
            if (signupCard) {
              signupCard.innerHTML = `
                <h3 style="margin: 0 0 5px 0; text-align: center; color: #44cc88; font-size: 14px;">¡CUENTA CREADA!</h3>
                <p style="text-align: center; font-size: 11px; margin: 10px 0;">Hemos enviado un correo de verificación a <b>${email}</b>.</p>
                <p style="text-align: center; font-size: 10px; color: #aaaacc;">Debes activarla antes de entrar.</p>
                <button id="backBtn" style="margin-top: 10px; padding: 8px; background: #3366ff; color: white; border: none; border-radius: 3px; cursor: pointer; font-weight: bold; width: 100%;">VOLVER AL LOGIN</button>
              `;
            }
          }
        } catch (e) {
          this._setErrorMessage(e.message);
          this._setLoading(false);
        }
      } else if (event.target.id === 'backBtn') {
        this._showLoginForm();
      }
    });
  }

  _setLoading(isLoading) {
    if (isLoading) {
      this.statusText.setText('Conectando...').setColor('#ffcc00');
    } else {
      // Don't reset to generic title if we have an error or success message
    }
  }

  _setErrorMessage(msg) {
    this.statusText.setText(msg).setColor('#ff4444');
  }
}
