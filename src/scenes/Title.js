import Phaser from 'phaser';
import { VW, VH, COLORS, setupCamera } from '../config.js';
import { Parallax } from '../background.js';
import { label, soundToggle, formatInt, fadeMusic, pillButton } from '../ui.js';
import { save } from '../storage.js';

export default class Title extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create() {
    this.leaving = false;
    setupCamera(this);
    this.bg = new Parallax(this);
    this.scroll = 0;

    const cx = VW / 2;
    const gem = this.add.image(cx, VH * 0.27, 'player').setScale(0.62).setScrollFactor(0);
    this.tweens.add({ targets: gem, y: gem.y - 10, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.tweens.add({ targets: gem, angle: 360, duration: 14000, repeat: -1 });

    const t1 = label(this, cx, VH * 0.43, 'DIAMOND', 64, '200', COLORS.text, 22).setOrigin(0.5);
    const t2 = label(this, cx, VH * 0.53, 'DASH', 30, '700', COLORS.cyan, 26).setOrigin(0.5);
    const line = this.add.rectangle(cx, VH * 0.6, 56, 1.5, 0xffffff, 0.35).setScrollFactor(0);

    const best = save.get('best');
    const total = save.get('totalGems');
    const stats = best > 0
      ? `RECORDE  ${formatInt(best)} m     ·     DIAMANTES  ${formatInt(total)}`
      : 'TOQUE À ESQUERDA PARA PULAR  ·  À DIREITA PARA DASH';
    label(this, cx, VH * 0.665, stats, 14, '300', COLORS.dim, 4).setOrigin(0.5);

    const endless = pillButton(this, cx - 150, VH * 0.82, 'CORRIDA INFINITA', () => this.go('Game'), { w: 270 });
    const studio = pillButton(this, cx + 150, VH * 0.82, '✦ FASES COM IA', () => this.go('Studio'), { w: 270, primary: false });
    [endless, studio].forEach((b, i) => {
      b.setAlpha(0);
      this.tweens.add({ targets: b, alpha: 1, duration: 700, delay: 700 + i * 120 });
    });

    soundToggle(this, VW - 48, 48);

    [gem, t1, t2, line].forEach((o, i) => {
      o.setAlpha(0);
      this.tweens.add({ targets: o, alpha: 1, duration: 900, delay: 150 + i * 120 });
    });

    fadeMusic(this, 'menu', 0.6);

    this.input.keyboard?.once('keydown-SPACE', () => this.go('Game'));
    this.input.keyboard?.once('keydown-ENTER', () => this.go('Game'));
  }

  go(scene) {
    if (this.leaving) return;
    this.leaving = true;
    this.cameras.main.fadeOut(350, 5, 6, 26);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(scene));
  }

  update(_, dt) {
    this.scroll += dt * 0.06;
    this.bg.update(this.scroll * 10);
  }
}
