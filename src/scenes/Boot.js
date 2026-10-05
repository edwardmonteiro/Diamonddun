import Phaser from 'phaser';
import { VW, VH, FONT, setupCamera } from '../config.js';
import { save } from '../storage.js';

const SPRITES = ['player', 'gem', 'gem_big', 'spikes', 'saw', 'stalactite', 'wall', 'ground', 'plat', 'plat_crumble',
  'emitter', 'dot', 'sparkle', 'shard', 'i_pause', 'i_play', 'i_sound', 'i_mute', 'i_replay', 'i_home'];
const LAYERS = ['sky', 'far', 'mid', 'near', 'mist'];
const SOUNDS = ['music', 'menu', 'jump', 'djump', 'dash', 'gem0', 'gem1', 'gem2', 'gem3', 'gem4', 'gem5',
  'shatter', 'land', 'death', 'tap', 'record', 'tick', 'laser'];

export default class Boot extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    setupCamera(this);
    const cx = VW / 2;
    const cy = VH / 2;
    this.add.text(cx, cy - 34, 'DIAMOND DASH', { fontFamily: FONT, fontSize: '22px', fontStyle: '300', color: '#cfd8ff' })
      .setOrigin(0.5).setLetterSpacing(10);
    const track = this.add.rectangle(cx, cy + 10, 260, 2, 0x2a2a5a).setOrigin(0.5);
    const bar = this.add.rectangle(cx - 130, cy + 10, 1, 2, 0x6eebff).setOrigin(0, 0.5);
    this.load.on('progress', (p) => bar.setSize(260 * p, 2));
    track.setAlpha(0.8);

    const base = 'assets/';
    SPRITES.forEach((k) => this.load.image(k, `${base}sprites/${k}.png`));
    LAYERS.forEach((k) => this.load.image(`bg_${k}`, `${base}bg/${k}.png`));
    SOUNDS.forEach((k) => this.load.audio(k, `${base}audio/${k}.ogg`));
  }

  create() {
    this.sound.mute = !!save.get('muted');
    this.scene.start('Title');
  }
}
