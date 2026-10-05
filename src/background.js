import Phaser from 'phaser';
import { VW, VH } from './config.js';
import crops from './bgcrops.json';

const LOWFX = /[?&]lowfx\b/.test(location.search);

/** Five-layer parallax backdrop, fixed to the camera. */
export class Parallax {
  constructor(scene) {
    this.scene = scene;
    const mk = (key, depth, alpha = 1) => {
      const top = crops[key.replace('bg_', '')] || 0;
      return scene.add.tileSprite(0, top, VW, VH - top, key).setOrigin(0).setScrollFactor(0).setDepth(depth).setAlpha(alpha);
    };
    this.layers = [
      { s: mk('bg_sky', -100), f: 0.015 },
      { s: mk('bg_far', -90), f: 0.06 },
      { s: mk('bg_mid', -80), f: 0.16 },
      { s: mk('bg_near', -70), f: 0.34 },
      { s: mk('bg_mist', -60, 0.9), f: 0.55 },
    ];
    if (LOWFX) this.layers.forEach((l) => l.s.setVisible(false));
    // chasm shading: pits fade into darkness
    const g = scene.add.graphics().setScrollFactor(0).setDepth(-55);
    g.fillGradientStyle(0x05061a, 0x05061a, 0x05061a, 0x05061a, 0, 0, 0.92, 0.92);
    g.fillRect(0, VH - 170, VW, 170);
    // ambient motes drifting across the screen
    this.motes = scene.add.particles(0, 0, 'dot', {
      x: { min: 0, max: VW },
      y: { min: 60, max: VH - 40 },
      lifespan: { min: 4000, max: 8000 },
      speedX: { min: -24, max: -6 },
      speedY: { min: -10, max: 4 },
      scale: { start: 0.12, end: 0 },
      alpha: { start: 0.55, end: 0 },
      tint: [0x6eebff, 0xb69bff, 0xff7ad9],
      blendMode: Phaser.BlendModes.ADD,
      frequency: 260,
      quantity: 1,
    }).setScrollFactor(0).setDepth(-50);
  }

  update(scrollX) {
    if (LOWFX) return;
    for (const l of this.layers) l.s.tilePositionX = scrollX * l.f;
  }
}
