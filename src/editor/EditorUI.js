/**
 * EditorUI — DOM chrome for OverlayEditorScene (RFC 0018 v2).
 *
 * Pure DOM, no Phaser references. The scene owns state and passes callbacks
 * for user actions. `update(state)` refreshes selection highlights and the
 * ✅/❓ status markers, driven by the in-memory manifest.
 */

const STYLE_ID = 'overlay-editor-ui-style';

const CSS = `
#overlay-editor-root:focus { outline: none; }
#overlay-editor-root {
  position: fixed; inset: 0;
  display: grid;
  grid-template-columns: 110px 180px 1fr;
  grid-template-rows: 52px 1fr 96px;
  grid-template-areas:
    "fighters toolbar     toolbar"
    "fighters anims       canvas"
    "accessories accessories accessories";
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #eef;
  z-index: 100;
  pointer-events: none;
}
#overlay-editor-root > section { pointer-events: auto; }
#overlay-editor-root .slot-canvas { grid-area: canvas; pointer-events: none; }
#overlay-editor-root .panel {
  background: rgba(18,20,34,0.96);
  border: 1px solid #2a3050;
  box-sizing: border-box;
  overflow: auto;
}
#overlay-editor-root .panel-fighters { grid-area: fighters; padding: 6px 4px; }
#overlay-editor-root .panel-anims    { grid-area: anims;    padding: 6px 4px; }
#overlay-editor-root .panel-toolbar  { grid-area: toolbar;  padding: 6px 10px; display:flex; align-items:center; gap:8px; }
#overlay-editor-root .panel-acc      { grid-area: accessories; padding: 8px 10px; display:flex; align-items:center; gap:10px; }

#overlay-editor-root .list-btn {
  display: block; width: 100%; margin: 2px 0;
  padding: 8px 10px;
  background: #242845; color: #cfd4ff;
  border: 1px solid #2a3050; border-radius: 6px;
  font: inherit; font-size: 13px; font-weight: 500;
  text-align: left; cursor: pointer;
}
#overlay-editor-root .list-btn:hover { background: #303666; }
#overlay-editor-root .list-btn.active { background: #3d60a8; color: #fff; border-color: #6fa0ff; }
#overlay-editor-root .list-btn .status { float: right; font-weight: 700; }
#overlay-editor-root .list-btn .status.ok   { color: #66e08a; }
#overlay-editor-root .list-btn .status.miss { color: #ff9a6a; }

#overlay-editor-root .tb-btn {
  padding: 6px 12px;
  background: #2a2f55; color: #dfe4ff;
  border: 1px solid #3a4070; border-radius: 6px;
  font: inherit; font-size: 13px; font-weight: 600;
  cursor: pointer;
}
#overlay-editor-root .tb-btn:hover { background: #3a4377; }
#overlay-editor-root .tb-btn.primary { background: #2b6d3d; border-color: #46a35d; }
#overlay-editor-root .tb-btn.primary:hover { background: #348849; }
#overlay-editor-root .tb-sep { width: 1px; height: 24px; background: #3a4070; }
#overlay-editor-root .tb-ctx { flex: 1; font-size: 12px; color: #9aa0c4; text-align: right; padding-right: 8px; }
#overlay-editor-root .tb-status { font-size: 12px; color: #66ccff; min-width: 180px; text-align: right; }

#overlay-editor-root .acc-btn {
  width: 64px; height: 64px; padding: 0;
  background: #1c2040; border: 2px solid #2a3050; border-radius: 8px;
  cursor: pointer; display:flex; align-items:center; justify-content:center;
  color:#cfd4ff; font-size:11px; font-weight:600;
}
#overlay-editor-root .acc-btn img { max-width: 54px; max-height: 54px; }
#overlay-editor-root .acc-btn.active { border-color: #6fa0ff; background: #2a335e; }
#overlay-editor-root .acc-label { font-size: 13px; color: #9aa0c4; font-weight: 600; margin-left: auto; }

#overlay-editor-root .panel-title {
  font-size: 10px; color: #8a90b8; font-weight: 700; letter-spacing: 0.08em;
  padding: 2px 4px 6px; text-transform: uppercase;
}

#overlay-editor-root .timeline {
  display:flex; gap:4px; padding:4px 8px;
  background: rgba(18,20,34,0.9); border-top: 1px solid #2a3050;
  position:absolute; left:50%; transform:translateX(-50%);
  bottom: 100px;
  border-radius: 6px;
}
#overlay-editor-root .tl-dot {
  width: 12px; height: 12px; border-radius: 50%;
  background: #555a80; border: 2px solid transparent;
  cursor: pointer;
}
#overlay-editor-root .tl-dot.kf { background: #ffcc44; }
#overlay-editor-root .tl-dot.current { border-color: #6fa0ff; }
`;

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'className') node.className = v;
    else if (k === 'onClick') node.addEventListener('click', v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

export class EditorUI {
  constructor({ fighters, animations, accessories, handlers }) {
    this.fighters = fighters;
    this.animations = animations;
    this.accessories = accessories;
    this.handlers = handlers;
    this._fighterBtns = new Map();
    this._animBtns = new Map();
    this._accBtns = new Map();
    this._tlDots = [];
    this._build();
  }

  _build() {
    injectStyles();
    // tabindex makes the root focusable so browser shortcuts (Ctrl+S, Ctrl+E)
    // bubble to our capture-listener instead of hitting the browser's default
    // "Save page" dialog on the very first key press.
    this.root = el('div', { id: 'overlay-editor-root', tabindex: '-1' });

    // Fighter panel
    this.fighterPanel = el('section', { className: 'panel panel-fighters' });
    this.fighterPanel.appendChild(el('div', { className: 'panel-title', text: 'Fighters' }));
    for (const id of this.fighters) {
      const btn = el('button', {
        className: 'list-btn',
        onClick: () => this.handlers.onFighter(id),
      });
      const label = el('span', { text: id });
      const status = el('span', { className: 'status' });
      btn.appendChild(label);
      btn.appendChild(status);
      btn._status = status;
      this._fighterBtns.set(id, btn);
      this.fighterPanel.appendChild(btn);
    }
    this.root.appendChild(this.fighterPanel);

    // Animation panel
    this.animPanel = el('section', { className: 'panel panel-anims' });
    this.animPanel.appendChild(el('div', { className: 'panel-title', text: 'Animations' }));
    for (const name of this.animations) {
      const btn = el('button', {
        className: 'list-btn',
        onClick: () => this.handlers.onAnim(name),
      });
      const label = el('span', { text: name });
      const status = el('span', { className: 'status' });
      btn.appendChild(label);
      btn.appendChild(status);
      btn._status = status;
      this._animBtns.set(name, btn);
      this.animPanel.appendChild(btn);
    }
    this.root.appendChild(this.animPanel);

    // Toolbar
    this.toolbar = el('section', { className: 'panel panel-toolbar' });
    const tb = (label, action, extraClass = '') => {
      const b = el('button', {
        className: `tb-btn ${extraClass}`,
        onClick: () => this.handlers.onAction(action),
        title: label,
        text: label,
      });
      return b;
    };
    this.toolbar.appendChild(tb('← mover', 'move-left'));
    this.toolbar.appendChild(tb('↑', 'move-up'));
    this.toolbar.appendChild(tb('↓', 'move-down'));
    this.toolbar.appendChild(tb('→', 'move-right'));
    this.toolbar.appendChild(el('div', { className: 'tb-sep' }));
    this.toolbar.appendChild(tb('↺ rotar', 'rotate-ccw'));
    this.toolbar.appendChild(tb('↻', 'rotate-cw'));
    this.toolbar.appendChild(el('div', { className: 'tb-sep' }));
    this.toolbar.appendChild(tb('− escala', 'scale-down'));
    this.toolbar.appendChild(tb('+', 'scale-up'));
    this.toolbar.appendChild(el('div', { className: 'tb-sep' }));
    this.toolbar.appendChild(tb('⤺ undo', 'undo'));
    this.toolbar.appendChild(tb('⤻ redo', 'redo'));
    this.toolbar.appendChild(el('div', { className: 'tb-sep' }));
    this.toolbar.appendChild(tb('Keyframe [F]', 'keyframe'));
    this.toolbar.appendChild(tb('Interpolar [I]', 'interpolate'));
    this.toolbar.appendChild(tb('Copiar a todos', 'fill-frames'));
    this.toolbar.appendChild(el('div', { className: 'tb-sep' }));
    this.toolbar.appendChild(tb('Propagar offset [P]', 'propagate-offset'));
    this.ctxText = el('span', { className: 'tb-ctx', text: '' });
    this.toolbar.appendChild(this.ctxText);
    this.toolbar.appendChild(tb('💾 Guardar', 'save', 'primary'));
    this.statusText = el('span', { className: 'tb-status', text: '' });
    this.toolbar.appendChild(this.statusText);
    this.root.appendChild(this.toolbar);

    // Canvas slot (transparent — lets Phaser canvas show through)
    this.root.appendChild(el('div', { className: 'slot-canvas' }));

    // Timeline (overlay on canvas area)
    this.timeline = el('div', { className: 'timeline' });
    this.root.appendChild(this.timeline);

    // Accessories row
    this.accPanel = el('section', { className: 'panel panel-acc' });
    this.accPanel.appendChild(el('div', { className: 'panel-title', text: 'Objetos' }));
    for (const acc of this.accessories) {
      const btn = el('button', {
        className: 'acc-btn',
        onClick: () => this.handlers.onAccessory(acc.id),
        title: acc.label ?? acc.id,
      });
      if (acc.imageUrl) {
        const img = el('img', { src: acc.imageUrl, alt: acc.id });
        btn.appendChild(img);
      } else {
        btn.textContent = acc.label ?? acc.id;
      }
      this._accBtns.set(acc.id, btn);
      this.accPanel.appendChild(btn);
    }
    this.accLabel = el('span', { className: 'acc-label', text: '' });
    this.accPanel.appendChild(this.accLabel);
    this.root.appendChild(this.accPanel);

    document.body.appendChild(this.root);
    // Grab focus so window-level keydown handlers fire before the browser
    // acts on Ctrl+S/E/Z. Without this the first keypress after page load
    // still pops the browser's Save dialog.
    this.root.focus();

    // Stop mouse clicks on buttons from stealing focus. If focus lands on a
    // button inside a scrollable panel, the browser's native arrow-key
    // scroll makes the fighter/anim list "jump" — confusing since Phaser's
    // arrow handlers cycle frames/anims, not that panel. preventDefault on
    // mousedown keeps focus on the root while still letting click handlers
    // fire normally.
    this.root.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) {
        e.preventDefault();
        // Refocus root asynchronously so the click still processes first.
        setTimeout(() => this.root?.focus(), 0);
      }
    });
  }

  update(state) {
    const { fighter, accessory, category, animation, frameIdx, frameCount, keyframes, manifest } =
      state;
    // Calibrations are keyed by category (v3), fall back to accessory for
    // older payloads.
    const key = category ?? accessory;

    // Fighter buttons: active + overall status across animations
    for (const [id, btn] of this._fighterBtns) {
      btn.classList.toggle('active', id === fighter);
      const calibsForFighter = manifest.calibrations?.[id]?.[key] ?? {};
      const count = Object.keys(calibsForFighter).length;
      if (count === 0) {
        btn._status.textContent = '❓';
        btn._status.className = 'status miss';
      } else if (count >= this.animations.length) {
        btn._status.textContent = '✅';
        btn._status.className = 'status ok';
      } else {
        btn._status.textContent = `${count}/${this.animations.length}`;
        btn._status.className = 'status miss';
      }
    }

    // Animation buttons: active + per-anim status
    for (const [name, btn] of this._animBtns) {
      btn.classList.toggle('active', name === animation);
      const has = manifest.has(fighter, key, name);
      btn._status.textContent = has ? '✅' : '❓';
      btn._status.className = `status ${has ? 'ok' : 'miss'}`;
    }

    // Accessory buttons
    for (const [id, btn] of this._accBtns) {
      btn.classList.toggle('active', id === accessory);
    }
    const accDef = this.accessories.find((a) => a.id === accessory);
    this.accLabel.textContent = accDef?.label ?? accessory;

    // Context line
    this.ctxText.textContent = `${fighter} · ${animation} · ${accessory} · frame ${frameIdx + 1}/${frameCount}`;

    // Timeline
    this._renderTimeline(frameCount, frameIdx, keyframes);
  }

  _renderTimeline(frameCount, frameIdx, keyframes) {
    while (this.timeline.firstChild) this.timeline.removeChild(this.timeline.firstChild);
    this._tlDots = [];
    const kfSet = new Set(keyframes);
    for (let i = 0; i < frameCount; i++) {
      const dot = el('div', {
        className: `tl-dot ${kfSet.has(i) ? 'kf' : ''} ${i === frameIdx ? 'current' : ''}`,
        title: `Frame ${i + 1}`,
        onClick: () => this.handlers.onFrame(i),
      });
      this._tlDots.push(dot);
      this.timeline.appendChild(dot);
    }
  }

  setStatus(text) {
    this.statusText.textContent = text ?? '';
  }

  destroy() {
    if (this.root?.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
  }
}
