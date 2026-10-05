import Phaser from 'phaser';
import { FONT, COLORS } from './config.js';
import { save } from './storage.js';

export function label(scene, x, y, text, size = 20, weight = '300', color = COLORS.text, spacing = 0) {
  const t = scene.add.text(x, y, text, {
    fontFamily: FONT,
    fontSize: `${size}px`,
    fontStyle: weight,
    color,
  });
  t.setResolution(2);
  t.setShadow(0, 2, 'rgba(5,6,26,0.85)', 10, false, true);
  if (spacing) t.setLetterSpacing(spacing);
  return t.setScrollFactor(0);
}

/** Round, minimal icon button. Returns a container. */
export function iconButton(scene, x, y, icon, onTap, r = 26) {
  const c = scene.add.container(x, y).setScrollFactor(0);
  const ring = scene.add.circle(0, 0, r, 0xffffff, 0.06).setStrokeStyle(1.5, 0xffffff, 0.35);
  const img = scene.add.image(0, 0, icon).setDisplaySize(r * 1.05, r * 1.05).setAlpha(0.92);
  c.add([ring, img]);
  c.setSize(r * 2.4, r * 2.4);
  c.setInteractive({ useHandCursor: true });
  c.on('pointerdown', (p, lx, ly, ev) => {
    ev?.stopPropagation?.();
    scene.tweens.add({ targets: c, scale: 0.88, duration: 70, yoyo: true });
    scene.sound.play('tap', { volume: 0.6 });
    onTap(c);
  });
  c.icon = img;
  return c;
}

/** Wide pill button with text. */
export function pillButton(scene, x, y, text, onTap, { w = 230, h = 54, primary = true } = {}) {
  const c = scene.add.container(x, y).setScrollFactor(0);
  const bg = scene.add.graphics();
  const draw = (hover) => {
    bg.clear();
    if (primary) {
      bg.fillStyle(0x6eebff, hover ? 1 : 0.95);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    } else {
      bg.fillStyle(0xffffff, 0.05);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
      bg.lineStyle(1.5, 0xffffff, 0.35);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    }
  };
  draw(false);
  const t = label(scene, 0, 1, text, 17, primary ? '700' : '500', primary ? '#071026' : COLORS.text, 4).setOrigin(0.5);
  c.add([bg, t]);
  c.setSize(w, h);
  c.setInteractive({ useHandCursor: true });
  c.on('pointerover', () => draw(true));
  c.on('pointerout', () => draw(false));
  c.on('pointerdown', (p, lx, ly, ev) => {
    ev?.stopPropagation?.();
    scene.tweens.add({ targets: c, scale: 0.94, duration: 70, yoyo: true });
    scene.sound.play('tap', { volume: 0.6 });
    scene.time.delayedCall(90, onTap);
  });
  return c;
}

export function soundToggle(scene, x, y) {
  const btn = iconButton(scene, x, y, save.get('muted') ? 'i_mute' : 'i_sound', () => {
    const m = !save.get('muted');
    save.set('muted', m);
    scene.sound.mute = m;
    btn.icon.setTexture(m ? 'i_mute' : 'i_sound');
  });
  return btn;
}

export function formatInt(n) {
  return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function fadeMusic(scene, key, volume = 0.55) {
  const sm = scene.sound;
  const current = sm.getAll('music').concat(sm.getAll('menu'));
  current.forEach((s) => {
    if (s.key === key && s.isPlaying) return;
    scene.tweens.add({ targets: s, volume: 0, duration: 600, onComplete: () => s.destroy() });
  });
  let m = current.find((s) => s.key === key && s.isPlaying);
  if (m) {
    scene.tweens.killTweensOf(m);
    m.setRate(1);
    scene.tweens.add({ targets: m, volume, duration: 600 });
  } else {
    m = sm.add(key, { loop: true, volume: 0 });
    m.play();
    scene.tweens.add({ targets: m, volume, duration: 900 });
  }
  return m;
}

export { Phaser };
