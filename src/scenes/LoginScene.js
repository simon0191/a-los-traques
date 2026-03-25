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
        <div id="form-status" style="text-align: center; font-size: 10px; min-height: 12px; color: #aaaacc; margin-bottom: 4px;">Inicia sesión para jugar</div>
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
      if (this._isLoading) return; // Debounce

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
        this.scene.start('TitleScene');
      }
    });
  }

  _showSignupForm() {
    if (this.form) this.form.destroy();

    const x = GAME_WIDTH / 2;
    const y = GAME_HEIGHT / 2; // Center exactly

    const html = `
      <div id="signup-card" style="color: white; font-family: Arial; font-size: 11px; display: flex; flex-direction: column; gap: 6px; width: 190px; max-height: 240px; overflow-y: auto; background: #1a1a3a; padding: 12px; border: 1px solid #4444aa; border-radius: 5px; box-sizing: border-box;">
        <h3 style="margin: 0 0 4px 0; text-align: center; color: #ffcc00; font-size: 13px;">NUEVA CUENTA</h3>
        <div id="form-status" style="text-align: center; font-size: 9px; min-height: 11px; color: #aaaacc; margin-bottom: 2px;">Completa los datos</div>
        <input type="text" id="nickname" placeholder="Apodo (ej: Simo)" style="padding: 4px; border-radius: 3px; border: 1px solid #444; background: #0a0a1a; color: white; font-size: 11px;">
        <input type="email" id="email" placeholder="Email" style="padding: 4px; border-radius: 3px; border: 1px solid #444; background: #0a0a1a; color: white; font-size: 11px;">
        <input type="password" id="password" placeholder="Contraseña" style="padding: 4px; border-radius: 3px; border: 1px solid #444; background: #0a0a1a; color: white; font-size: 11px;">
        <input type="password" id="passwordVerify" placeholder="Repetir Contraseña" style="padding: 4px; border-radius: 3px; border: 1px solid #444; background: #0a0a1a; color: white; font-size: 11px;">
        
        <button id="signupBtn" style="margin-top: 4px; padding: 6px; background: #44cc88; color: white; border: none; border-radius: 3px; cursor: pointer; font-weight: bold; font-size: 11px;">CREAR CUENTA</button>
        <button id="backBtn" style="padding: 4px; background: none; color: #aaaacc; border: none; cursor: pointer; font-size: 9px; width: 100%;">VOLVER AL INICIO</button>
      </div>
    `;

    this.form = this.add.dom(x, y).createFromHTML(html);
    this.form.addListener('click');

    this.form.on('click', async (event) => {
      if (this._isLoading && event.target.id !== 'backBtn') return; // Debounce

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

        if (password.length < 6) {
          this._setErrorMessage('La contraseña debe tener al menos 6 caracteres');
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
          this._setLoading(false);
        } catch (e) {
          let msg = e.message;
          // Check for Rate Limit (HTTP 429) or generic "Too Many Requests"
          if (
            e.status === 429 ||
            msg.toLowerCase().includes('rate limit') ||
            msg.toLowerCase().includes('too many requests')
          ) {
            msg = 'Demasiados intentos. Espera unos minutos o revisa tu email.';
          } else if (msg.includes('User already registered') || msg.includes('already exists')) {
            msg = 'Email o Apodo ya están en uso';
          } else if (msg.includes('Database error saving new user')) {
            // This usually happens when the trigger fails (e.g. nickname unique constraint)
            msg = 'El Apodo ya está registrado';
          }
          this._setErrorMessage(msg);
          this._setLoading(false);
        }
      } else if (event.target.id === 'backBtn') {
        this._showLoginForm();
      }
    });
  }

  _setLoading(isLoading) {
    this._isLoading = isLoading;
    const msg = isLoading ? 'Conectando...' : 'A LOS TRAQUES';
    const color = isLoading ? '#ffcc00' : '#aaaacc';

    this.statusText.setText(msg).setColor(color);

    if (this.form) {
      const statusDiv = this.form.getChildByID('form-status');
      if (statusDiv) {
        // If it's starting to load, we show "Procesando..."
        // If it's finishing loading (isLoading=false), we only clear it if it was "Procesando..."
        // to avoid clearing an error or success message.
        if (isLoading) {
          statusDiv.innerText = 'Procesando...';
          statusDiv.style.color = '#ffcc00';
        } else if (statusDiv.innerText === 'Procesando...') {
          statusDiv.innerText = '';
        }
      }
    }
  }

  _setErrorMessage(msg) {
    // Translate some common Supabase errors
    let userMsg = msg;
    if (msg === 'Invalid login credentials') {
      userMsg = 'Email o contraseña incorrectos';
    } else if (msg === 'Email not confirmed') {
      userMsg = 'Email no verificado. Revisa tu correo.';
    } else if (msg === 'User not found') {
      userMsg = 'Usuario no encontrado';
    }

    this.statusText.setText(userMsg).setColor('#ff4444');

    if (this.form) {
      const statusDiv = this.form.getChildByID('form-status');
      if (statusDiv) {
        statusDiv.innerText = userMsg;
        statusDiv.style.color = '#ff4444';
      }
    }
  }
}
