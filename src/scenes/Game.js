import Phaser from 'phaser';
import { VW, VH, PHYS, PX_PER_M, COLORS, setupCamera } from '../config.js';
import { Parallax } from '../background.js';
import { LevelGen } from '../level.js';
import { label, iconButton, pillButton, soundToggle, formatInt, fadeMusic } from '../ui.js';
import { save } from '../storage.js';
import { theme, themeHex } from '../ds/tokens.js';
import { recordPhaseResult } from '../ai/history.js';

const ADD = Phaser.BlendModes.ADD;
const START_X = 400;
const PLAYER_SCREEN_X = 0.26;
const GOD = typeof location !== 'undefined' && /[?&]god\b/.test(location.search);

export default class Game extends Phaser.Scene {
  constructor() {
    super('Game');
  }

  init(data) {
    this.spec = data?.spec || null;
    this.mode = this.spec ? 'phase' : 'endless';
    this.attempt = data?.attempt || 1;
    this.themeId = this.spec?.tema || 'aurora';
    this.tk = themeHex(this.themeId);
  }

  // ===================================================================== init
  create() {
    this.cam = setupCamera(this);
    this.cam.fadeIn(400, 5, 6, 26);
    this.bg = new Parallax(this, this.themeId);
    // scene instances are reused by Phaser: reset every per-run flag
    this.completed = false;
    this.overlay = null;
    this.pauseMenu = null;
    this.finishLineX = 0;
    this.progress = 0;
    this.deathReason = null;
    this.crashInfo = null;

    this.dead = false;
    this.paused = false;
    this.gemCount = 0;
    this.combo = 0;
    this.lastGemAt = 0;
    this.distance = 0;
    this.prevBest = save.get('best');
    this.recordShown = this.prevBest <= 0;
    this.nextMilestone = 500;
    this.clock = 0;

    // input state
    this.jumpPressedAt = -1;
    this.jumpHeld = false;
    this.dashPressedAt = -1;

    // player state
    this.lastGroundAt = 0;
    this.canDouble = true;
    this.cut = false;
    this.airborne = false;
    this.dashUntil = 0;
    this.dashReadyAt = 0;

    // world containers
    this.objects = [];
    this.stals = [];
    this.lasers = [];
    this.pending = null;

    this.solids = this.physics.add.staticGroup();
    this.oneway = this.physics.add.staticGroup();
    this.crumbles = this.physics.add.group({ allowGravity: false, immovable: true });
    this.gems = this.physics.add.group({ allowGravity: false, immovable: true });
    this.hazards = this.physics.add.group({ allowGravity: false, immovable: true });
    this.walls = this.physics.add.staticGroup();

    this.createPlayer();

    this.gen = new LevelGen(this, START_X, this.spec);
    this.gen.start(START_X);
    this.generate();

    this.physics.add.collider(this.player, this.solids);
    this.physics.add.collider(this.player, this.oneway);
    this.physics.add.collider(this.player, this.crumbles, (p, c) => this.touchCrumble(c));
    this.physics.add.overlap(this.player, this.gems, (p, g) => this.collect(g));
    this.physics.add.overlap(this.player, this.hazards, (pl, h) => this.die(`hazard:${h.texture.key}`));
    this.physics.add.overlap(this.player, this.walls, (p, w) => {
      if (this.isDashing()) this.shatter(w);
      else this.die('wall');
    });

    this.createFx();
    this.createHud();
    this.createInput();
    if (!save.get('tutorialDone')) this.showTutorial();
    else if (this.spec && this.attempt === 1) this.showIntro();

    this.cam.scrollX = this.player.x - VW * PLAYER_SCREEN_X;
    const music = fadeMusic(this, 'music', 0.5);
    music.setRate(theme(this.themeId).music || 1);

    this.onHidden = () => this.pause();
    this.game.events.on('hidden', this.onHidden);
    this.events.once('shutdown', () => this.game.events.off('hidden', this.onHidden));
  }

  createPlayer() {
    const p = this.physics.add.sprite(START_X, 540, 'player').setScale(0.5).setDepth(20);
    p.body.setSize(72, 72).setOffset(44, 44);
    p.body.setMaxVelocityY(1700);
    p.setVisible(false); // physics proxy; visuals live on this.gfx so squash/stretch never touches the hitbox
    this.player = p;
    this.gfx = this.add.image(p.x, p.y, 'player').setScale(0.5).setDepth(20);
    this.dashRing = this.add.graphics().setDepth(21);
  }

  createFx() {
    this.trail = this.add.particles(0, 0, 'dot', {
      lifespan: 360,
      speedX: { min: -40, max: -10 },
      speedY: { min: -12, max: 12 },
      scale: { start: 0.36, end: 0 },
      alpha: { start: 0.55, end: 0 },
      tint: this.spec ? [this.tk.accent, 0xffffff] : [0x6eebff, 0x9fdcff, 0xb69bff],
      blendMode: ADD,
      frequency: 14,
      follow: this.gfx,
    }).setDepth(19);

    this.burst = this.add.particles(0, 0, 'shard', {
      lifespan: { min: 500, max: 1100 },
      speed: { min: 160, max: 560 },
      angle: { min: 0, max: 360 },
      rotate: { min: 0, max: 360 },
      scale: { start: 0.6, end: 0 },
      gravityY: 900,
      blendMode: ADD,
      emitting: false,
    }).setDepth(30);

    this.spark = this.add.particles(0, 0, 'sparkle', {
      lifespan: 520,
      speed: { min: 40, max: 180 },
      scale: { start: 0.42, end: 0 },
      alpha: { start: 1, end: 0 },
      rotate: { min: 0, max: 90 },
      blendMode: ADD,
      emitting: false,
    }).setDepth(25);

    this.dust = this.add.particles(0, 0, 'dot', {
      lifespan: 380,
      speedX: { min: -120, max: 30 },
      speedY: { min: -90, max: -10 },
      scale: { start: 0.25, end: 0 },
      alpha: { start: 0.45, end: 0 },
      tint: 0xb9c6ff,
      blendMode: ADD,
      emitting: false,
    }).setDepth(18);

    this.flash = this.add.rectangle(0, 0, VW, VH, 0xffffff, 0).setOrigin(0).setScrollFactor(0).setDepth(200);
  }

  createHud() {
    const pad = 34;
    if (this.spec) {
      this.hudDist = label(this, pad, pad - 2, this.spec.nome.toUpperCase(), 15, '500', COLORS.text, 5).setDepth(100);
      this.hudUnit = label(this, pad, pad + 24, `TENTATIVA ${this.attempt}`, 10, '500', COLORS.dim, 5).setDepth(100);
      const bw = VW * 0.34;
      this.progTrack = this.add.rectangle(VW / 2 - bw / 2, pad + 16, bw, 3, 0xffffff, 0.16).setOrigin(0, 0.5).setScrollFactor(0).setDepth(100);
      this.progBar = this.add.rectangle(VW / 2 - bw / 2, pad + 16, 1, 3, this.tk.accent, 1).setOrigin(0, 0.5).setScrollFactor(0).setDepth(101);
      this.progGem = this.add.image(VW / 2 + bw / 2 + 14, pad + 16, 'sparkle').setScale(0.3).setScrollFactor(0).setDepth(101).setTint(this.tk.accent);
      this.progW = bw;
    } else {
      this.hudDist = label(this, pad, pad - 6, '0', 40, '200', COLORS.text).setDepth(100);
      this.hudUnit = label(this, pad, pad + 42, 'METROS', 11, '500', COLORS.dim, 5).setDepth(100);
    }

    this.pauseBtn = iconButton(this, VW - pad - 12, pad + 16, 'i_pause', () => this.pause(), 24).setDepth(100);
    this.hudGemIcon = this.add.image(VW - pad - 126, pad + 16, 'gem').setScale(0.5).setScrollFactor(0).setDepth(100);
    this.hudGems = label(this, VW - pad - 104, pad + 16, '0', 26, '300', COLORS.text).setOrigin(0, 0.5).setDepth(100);

    this.toastText = label(this, VW / 2, 120, '', 16, '500', COLORS.gold, 8).setOrigin(0.5).setDepth(100).setAlpha(0);
  }

  createInput() {
    const isUi = (p) => {
      const hits = this.input.hitTestPointer(p);
      return hits.length > 0;
    };
    this.input.on('pointerdown', (p) => {
      if (this.dead || this.paused || isUi(p)) return;
      const sx = p.x / this.cam.zoom;
      if (sx < VW * 0.5) {
        this.jumpPressedAt = this.clock;
        this.jumpHeld = true;
        p.__jump = true;
      } else {
        this.dashPressedAt = this.clock;
      }
    });
    this.input.on('pointerup', (p) => {
      if (p.__jump) this.jumpHeld = false;
      p.__jump = false;
    });

    const kb = this.input.keyboard;
    if (kb) {
      const jumpKeys = ['SPACE', 'UP', 'W', 'Z'];
      const dashKeys = ['RIGHT', 'SHIFT', 'X', 'D'];
      jumpKeys.forEach((k) => {
        const key = kb.addKey(k);
        key.on('down', () => {
          if (this.dead || this.paused) return;
          this.jumpPressedAt = this.clock;
          this.jumpHeld = true;
        });
        key.on('up', () => (this.jumpHeld = false));
      });
      dashKeys.forEach((k) => kb.addKey(k).on('down', () => {
        if (!this.dead && !this.paused) this.dashPressedAt = this.clock;
      }));
      kb.addKey('ESC').on('down', () => (this.paused ? this.resume() : this.pause()));
      kb.addKey('ENTER').on('down', () => this.dead && this.overlay && this.restart());
    }
  }

  showTutorial() {
    const mk = (x, title, sub) => {
      const c = this.add.container(x, VH * 0.5).setScrollFactor(0).setDepth(90);
      const ring = this.add.circle(0, -18, 34, 0xffffff, 0.05).setStrokeStyle(1.5, 0xffffff, 0.5);
      const t = label(this, 0, -18, title, 15, '700', COLORS.text, 5).setOrigin(0.5);
      const s = label(this, 0, 36, sub, 12, '300', COLORS.dim, 4).setOrigin(0.5);
      c.add([ring, t, s]);
      return c;
    };
    const divider = this.add.rectangle(VW / 2, VH * 0.5, 1, VH * 0.42, 0xffffff, 0.18).setScrollFactor(0).setDepth(90);
    const a = mk(VW * 0.25, 'PULAR', 'TOQUE À ESQUERDA · 2× NO AR');
    const b = mk(VW * 0.75, 'DASH', 'TOQUE À DIREITA · QUEBRA CRISTAIS');
    const all = [a, b, divider];
    all.forEach((o) => o.setAlpha(0));
    this.tweens.add({ targets: all, alpha: 1, duration: 500, delay: 300 });
    this.tweens.add({ targets: all, alpha: 0, duration: 700, delay: 5200, onComplete: () => all.forEach((o) => o.destroy()) });
  }

  // ============================================================ world api
  track(obj, right) {
    obj.__right = right;
    this.objects.push(obj);
    return obj;
  }

  ground(x, w, y, solidLeft) {
    const p = this.pending;
    if (p && Math.abs(p.x + p.w - x) < 1 && p.y === y) {
      p.w += w;
      return;
    }
    this.flushGround();
    this.pending = { x, w, y, solid: solidLeft };
  }

  flushGround() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    const h = VH - p.y + 60;
    const ts = this.add.tileSprite(p.x, p.y, p.w, h, 'ground').setOrigin(0).setDepth(10);
    ts.setTileScale(0.5, 0.5);
    if (this.spec) {
      ts.setTint(this.tk.ground);
      const edge = this.add.rectangle(p.x, p.y + 1, p.w, 2, this.tk.accent, 0.85).setOrigin(0, 0.5).setDepth(11).setBlendMode(ADD);
      this.track(edge, p.x + p.w);
    }
    ts.tilePositionX = p.x * 2;
    this.solids.add(ts);
    const b = ts.body;
    b.checkCollision.down = false;
    b.checkCollision.left = p.solid;
    b.checkCollision.right = false;
    this.track(ts, p.x + p.w);
  }

  plat(x, y, w, crumble) {
    const ts = this.add.tileSprite(x, y, w, 30, crumble ? 'plat_crumble' : 'plat').setOrigin(0).setDepth(10);
    ts.setTileScale(0.5, 0.5);
    if (this.spec && !crumble) ts.setTint(this.tk.ground);
    if (crumble) {
      this.crumbles.add(ts);
      ts.body.setAllowGravity(false).setImmovable(true);
      ts.body.setSize(w, 14, false).setOffset(0, 0);
      ts.body.checkCollision.down = ts.body.checkCollision.left = ts.body.checkCollision.right = false;
      ts.__crumble = { touched: false };
    } else {
      this.oneway.add(ts);
      ts.body.setSize(w, 14, false).setOffset(0, 0);
      ts.body.checkCollision.down = ts.body.checkCollision.left = ts.body.checkCollision.right = false;
    }
    this.track(ts, x + w);
  }

  gem(x, y) {
    const g = this.gems.create(x, y, 'gem').setScale(0.5).setDepth(15);
    g.body.setAllowGravity(false);
    g.body.setSize(56, 56).setOffset(20, 16);
    this.tweens.add({ targets: g, y: y - 5, duration: 900 + Math.random() * 300, yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: Math.random() * 600 });
    this.track(g, x + 20);
  }

  spikes(x, groundY) {
    const s = this.hazards.create(x, groundY + 4, 'spikes').setOrigin(0.5, 1).setScale(0.5).setDepth(12);
    s.body.setAllowGravity(false);
    s.body.setSize(96, 54).setOffset(36, 136 - 8 - 54);
    this.track(s, x + 60);
  }

  saw(x, y, { move = false, range = 180, period = 1500 } = {}) {
    const s = this.hazards.create(x, y, 'saw').setScale(0.5).setDepth(12);
    s.body.setAllowGravity(false);
    s.body.setCircle(72, 130 - 72, 130 - 72);
    this.tweens.add({ targets: s, angle: 360, duration: 900, repeat: -1 });
    if (move) {
      s.y = y;
      this.tweens.add({ targets: s, y: y - range, duration: period / 2, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }
    // dark slot it emerges from
    const slot = this.add.rectangle(x, move ? y + 30 : y + 2, 6, move ? range + 60 : 10, 0x000000, 0.35)
      .setOrigin(0.5, move ? 1 : 0.5).setDepth(11);
    this.track(slot, x + 60);
    this.track(s, x + 70);
  }

  wall(x, groundY) {
    const w = 54;
    const ts = this.add.tileSprite(x - w / 2, -20, w, groundY + 22, 'wall').setOrigin(0).setDepth(13);
    ts.setTileScale(0.45, 0.5);
    ts.setBlendMode(ADD);
    this.walls.add(ts);
    ts.body.setSize(w - 10, groundY + 20, false).setOffset(5, 0);
    ts.__shine = this.tweens.add({ targets: ts, alpha: 0.75, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.track(ts, x + w);
  }

  stal(x, groundY) {
    const s = this.hazards.create(x, -14, 'stalactite').setOrigin(0.5, 0).setScale(0.5).setDepth(12);
    s.body.setAllowGravity(false);
    s.body.setSize(30, 190).setOffset(35, 10);
    s.__stal = { state: 'idle', groundY, baseX: x };
    this.stals.push(s);
    this.track(s, x + 40);
  }

  laser(x, groundY, { period = 1700, on = 0.45 } = {}) {
    const top = this.add.image(x, 22, 'emitter').setScale(0.5).setAngle(180).setDepth(14);
    const bot = this.add.image(x, groundY - 10, 'emitter').setScale(0.5).setDepth(14);
    const beam = this.add.rectangle(x, 30, 10, groundY - 46, 0xff4f7a, 0).setOrigin(0.5, 0).setDepth(13).setBlendMode(ADD);
    const core = this.add.rectangle(x, 30, 3, groundY - 46, 0xffffff, 0).setOrigin(0.5, 0).setDepth(13).setBlendMode(ADD);
    const L = { x, groundY, period, on, phase: Math.random() * period, beam, core, wasOn: false };
    this.lasers.push(L);
    [top, bot, beam, core].forEach((o) => this.track(o, x + 30));
    L.dead = () => !beam.active;
  }

  finish(x, groundY) {
    const c = this.tk.accent;
    const h = groundY + 20;
    const glow = this.add.rectangle(x, groundY, 90, h, c, 0.16).setOrigin(0.5, 1).setDepth(9).setBlendMode(ADD);
    const beam = this.add.rectangle(x, groundY, 6, h, 0xffffff, 0.9).setOrigin(0.5, 1).setDepth(14).setBlendMode(ADD);
    const halo = this.add.rectangle(x, groundY, 26, h, c, 0.45).setOrigin(0.5, 1).setDepth(13).setBlendMode(ADD);
    const crown = this.add.image(x, groundY - 210, 'gem_big').setScale(0.9).setDepth(15).setTint(c);
    this.tweens.add({ targets: [halo, glow], alpha: 0.08, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.tweens.add({ targets: crown, y: crown.y - 14, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    const t = label(this, x, groundY - 280, 'CHEGADA', 14, '700', COLORS.text, 10).setOrigin(0.5).setScrollFactor(1).setDepth(16);
    const fx = this.add.particles(x, groundY, 'sparkle', {
      x: { min: -30, max: 30 }, y: { min: -h, max: 0 }, lifespan: 900, speedY: { min: -60, max: -20 },
      scale: { start: 0.3, end: 0 }, tint: [c, 0xffffff], blendMode: ADD, frequency: 60,
    }).setDepth(15);
    [glow, beam, halo, crown, t, fx].forEach((o) => this.track(o, x + 2000));
    this.finishLineX = x;
  }

  hint(x, y, text) {
    const t = label(this, x, y, text, 14, '700', COLORS.text, 8).setOrigin(0.5).setScrollFactor(1).setDepth(16).setAlpha(0.75);
    const arrow = this.add.triangle(x, y + 24, 0, 0, 12, 0, 6, 8, 0xffffff, 0.6).setDepth(16);
    this.track(t, x + 100);
    this.track(arrow, x + 100);
  }

  // ======================================================== interactions
  collect(g) {
    if (!g.active) return;
    const now = this.clock;
    this.combo = now - this.lastGemAt < 0.9 ? Math.min(this.combo + 1, 5) : 0;
    this.lastGemAt = now;
    this.sound.play(`gem${this.combo}`, { volume: 0.5 });
    this.spark.explode(5, g.x, g.y);
    this.gemCount++;

    // fly a ghost to the HUD counter
    const sx = (g.x - this.cam.scrollX);
    const sy = g.y - this.cam.scrollY;
    g.destroy();
    const ghost = this.add.image(sx, sy, 'gem').setScale(0.5).setScrollFactor(0).setDepth(101).setBlendMode(ADD);
    this.tweens.add({
      targets: ghost, x: this.hudGemIcon.x, y: this.hudGemIcon.y, scale: 0.35, duration: 420, ease: 'Cubic.in',
      onComplete: () => {
        ghost.destroy();
        this.hudGems.setText(formatInt(this.gemCount));
        this.tweens.add({ targets: this.hudGemIcon, scale: 0.62, duration: 80, yoyo: true });
      },
    });
  }

  touchCrumble(c) {
    const st = c.__crumble;
    if (!st || st.touched || !this.player.body.touching.down) return;
    st.touched = true;
    this.sound.play('tick', { volume: 0.5 });
    this.tweens.add({ targets: c, x: c.x + 2, duration: 40, yoyo: true, repeat: 4 });
    this.time.delayedCall(360, () => {
      if (!c.active) return;
      c.body.checkCollision.none = true;
      c.body.setImmovable(false).setAllowGravity(true);
      this.tweens.add({ targets: c, alpha: 0, duration: 600 });
      this.burst.emitParticle(6, c.x + c.width / 2, c.y + 10);
    });
  }

  shatter(w) {
    if (!w.active) return;
    this.sound.play('shatter', { volume: 0.7 });
    const x = w.x + w.width / 2;
    for (let y = 40; y < w.height; y += 60) {
      this.burst.setParticleTint(0x7feaff);
      this.burst.explode(4, x, y);
    }
    this.cam.shake(140, 0.006);
    this.flash.setAlpha(0.18);
    this.tweens.add({ targets: this.flash, alpha: 0, duration: 260 });
    w.__shine?.stop();
    w.destroy();
  }

  isDashing() {
    return this.clock < this.dashUntil;
  }

  die(reason = '') {
    if (this.dead) return;
    this.deathReason = reason;
    if (GOD) {
      if (this.player.y > VH) this.player.setPosition(this.player.x, 200).body.setVelocityY(0);
      return;
    }
    this.dead = true;
    const p = this.player;
    this.sound.play('death', { volume: 0.8 });
    this.burst.setParticleTint(0x6eebff);
    this.burst.explode(26, p.x, p.y);
    this.spark.explode(12, p.x, p.y);
    this.gfx.setVisible(false);
    p.body.enable = false;
    this.trail.stop();
    this.dashRing.clear();
    this.cam.shake(260, 0.012);
    this.flash.setFillStyle(0xff7ad9).setAlpha(0.35);
    this.tweens.add({ targets: this.flash, alpha: 0, duration: 500 });
    this.sound.getAll('music').forEach((m) => this.tweens.add({ targets: m, volume: 0.15, rate: 0.9, duration: 700 }));
    this.time.delayedCall(950, () => this.gameOver());
  }

  // ================================================================= loop
  update(_, dtMs) {
    if (this.paused) return;
    const dt = Math.min(dtMs, 50) / 1000;
    this.clock += dt;

    const camX = this.cam.scrollX;
    this.bg.update(camX);
    this.updateLasers(dt);
    this.updateStals();

    if (!this.dead) this.updatePlayer(dt);

    // camera follows smoothly; dash pushes ahead of it a little
    if (!this.dead) {
      const target = this.player.x - VW * PLAYER_SCREEN_X;
      this.cam.scrollX += (target - this.cam.scrollX) * Math.min(1, dt * 10);
    }

    this.generate();
    this.cleanup();
  }

  updatePlayer(dt) {
    const p = this.player;
    const b = p.body;
    const t = this.clock;
    const traveled = p.x - START_X;
    const S = this.gen.speedAt(traveled);

    const onGround = b.blocked.down || b.touching.down;
    if (onGround) {
      if (this.airborne && b.velocity.y >= 0) this.land();
      this.lastGroundAt = t;
      this.canDouble = true;
      this.airborne = false;
    } else {
      this.airborne = true;
    }

    // dash
    if (this.dashPressedAt >= 0 && t - this.dashPressedAt < PHYS.buffer && t >= this.dashReadyAt) {
      this.dashPressedAt = -1;
      this.dashUntil = t + PHYS.dashTime;
      this.dashReadyAt = t + PHYS.dashCooldown;
      this.sound.play('dash', { volume: 0.7 });
      this.cam.shake(90, 0.003);
      this.ghostTimer = 0;
    }
    const dashing = this.isDashing();
    b.setAllowGravity(!dashing);
    if (dashing) {
      b.setVelocityY(0);
      this.ghostTimer -= dt;
      if (this.ghostTimer <= 0) {
        this.ghostTimer = 0.025;
        const gh = this.add.image(p.x, p.y, 'player').setScale(0.5).setAngle(this.gfx.angle).setTint(0x8ff0ff)
          .setAlpha(0.5).setBlendMode(ADD).setDepth(18);
        this.tweens.add({ targets: gh, alpha: 0, scale: 0.42, duration: 260, onComplete: () => gh.destroy() });
      }
    }

    // jump (with buffer + coyote) and double jump
    if (this.jumpPressedAt >= 0 && t - this.jumpPressedAt < PHYS.buffer) {
      if (t - this.lastGroundAt < PHYS.coyote) {
        this.doJump(PHYS.jump, 'jump');
        this.lastGroundAt = -1;
      } else if (this.canDouble && this.airborne) {
        this.canDouble = false;
        this.doJump(PHYS.djump, 'djump');
        this.spark.explode(6, p.x, p.y + 14);
      }
    }
    if (!this.jumpHeld && !this.cut && b.velocity.y < -380) {
      b.setVelocityY(b.velocity.y * 0.5);
      this.cut = true;
    }

    b.setVelocityX(S + (dashing ? PHYS.dashBoost : 0));

    // spin while airborne
    if (this.airborne) this.gfx.angle += (dashing ? 900 : 420) * dt;
    this.gfx.setPosition(p.x, p.y);

    // death checks
    if (b.blocked.right) {
      // ledge assist: if we clipped a corner by a few pixels, pop up onto it instead of crashing
      const top = this.solidTopAt(b.right + 2);
      const lift = b.bottom - top;
      if (top < Infinity && lift > 0 && lift < 26) {
        p.y -= lift + 1;
        b.updateFromGameObject?.();
        b.setVelocityY(Math.min(b.velocity.y, 0));
      } else {
        this.crashInfo = { feet: Math.round(b.bottom), top: Math.round(top), x: Math.round(b.right) };
        this.die('crash');
      }
    }
    if (p.y > VH + 90) this.die('fall');

    // lasers
    if (!dashing) {
      for (const L of this.lasers) {
        if (L.isOn && Math.abs(p.x - L.x) < 20 && p.y < L.groundY) {
          this.die('laser');
          break;
        }
      }
    }

    // dash-readiness ring
    this.dashRing.clear();
    if (t < this.dashReadyAt && !dashing) {
      const k = 1 - (this.dashReadyAt - t) / PHYS.dashCooldown;
      this.dashRing.lineStyle(2, 0x6eebff, 0.6);
      this.dashRing.beginPath();
      this.dashRing.arc(p.x, p.y, 30, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
      this.dashRing.strokePath();
    }

    // HUD
    this.distance = Math.max(0, traveled / PX_PER_M);
    if (this.spec) {
      const prog = this.gen.progressAt(p.x);
      this.progress = Math.max(this.progress || 0, prog);
      this.progBar.width = Math.max(1, this.progW * this.progress);
      if (this.finishLineX && p.x >= this.finishLineX) this.complete();
      return;
    }
    this.hudDist.setText(formatInt(this.distance));
    if (this.distance >= this.nextMilestone) {
      this.toast(`${formatInt(this.nextMilestone)} m`, COLORS.cyan);
      this.nextMilestone += 500;
    }
    if (!this.recordShown && this.distance > this.prevBest) {
      this.recordShown = true;
      this.toast('NOVO RECORDE', COLORS.gold);
      this.sound.play('record', { volume: 0.5 });
    }
  }

  solidTopAt(x) {
    let top = Infinity;
    for (const c of this.solids.getChildren()) {
      const bb = c.body;
      if (bb && x >= bb.left && x <= bb.right) top = Math.min(top, bb.top);
    }
    return top;
  }

  doJump(v, sfx) {
    const p = this.player;
    p.body.setVelocityY(-v);
    this.jumpPressedAt = -1;
    this.cut = false;
    this.airborne = true;
    this.sound.play(sfx, { volume: 0.55 });
    this.gfx.setScale(0.42, 0.58);
    this.tweens.add({ targets: this.gfx, scaleX: 0.5, scaleY: 0.5, duration: 160, ease: 'Quad.out' });
    if (sfx === 'jump') this.dust.explode(5, p.x - 6, p.y + 18);
  }

  land() {
    const p = this.player;
    this.sound.play('land', { volume: 0.4 });
    this.dust.explode(6, p.x, p.y + 18);
    const g = this.gfx;
    const snap = Math.round(g.angle / 45) * 45;
    this.tweens.add({ targets: g, angle: snap, duration: 90 });
    g.setScale(0.58, 0.42);
    this.tweens.add({ targets: g, scaleX: 0.5, scaleY: 0.5, duration: 180, ease: 'Back.out' });
  }

  updateLasers() {
    const t = this.clock * 1000;
    const px = this.player.x;
    for (const L of this.lasers) {
      if (!L.beam.active) continue;
      const ph = (t + L.phase) % L.period;
      const onStart = L.period * (1 - L.on);
      const warn = ph > onStart - 320 && ph < onStart;
      L.isOn = ph >= onStart;
      if (L.isOn) {
        const flick = 0.85 + Math.random() * 0.15;
        L.beam.setSize(14, L.beam.height).setFillStyle(0xff4f7a, 0.55 * flick);
        L.core.setFillStyle(0xffffff, 0.95 * flick);
        if (!L.wasOn && Math.abs(px - L.x) < VW) this.sound.play('laser', { volume: 0.35 });
      } else if (warn) {
        L.beam.setSize(3, L.beam.height).setFillStyle(0xff4f7a, Math.random() < 0.5 ? 0.35 : 0.1);
        L.core.setFillStyle(0xffffff, 0);
      } else {
        L.beam.setFillStyle(0xff4f7a, 0);
        L.core.setFillStyle(0xffffff, 0);
      }
      L.wasOn = L.isOn;
    }
    this.lasers = this.lasers.filter((L) => L.beam.active);
  }

  updateStals() {
    const p = this.player;
    for (const s of this.stals) {
      if (!s.active) continue;
      const st = s.__stal;
      const S = this.gen.speedAt(p.x - START_X);
      if (st.state === 'idle' && s.x - p.x < S * 0.8 + 270 && !this.dead) {
        st.state = 'shaking';
        this.sound.play('tick', { volume: 0.6 });
        this.tweens.add({ targets: s, x: st.baseX + 3, duration: 35, yoyo: true, repeat: 3 });
        this.time.delayedCall(220, () => {
          if (!s.active) return;
          st.state = 'falling';
          s.x = st.baseX;
          s.body.setAllowGravity(true);
          s.body.setVelocityY(150);
        });
      } else if (st.state === 'falling') {
        const tipY = s.y + s.displayHeight - 8;
        if (tipY >= st.groundY + 48) {
          st.state = 'stuck';
          s.body.setAllowGravity(false);
          s.body.setVelocity(0, 0);
          s.y = st.groundY + 48 - s.displayHeight + 8;
          // only the exposed tip remains dangerous
          s.body.setSize(30, 60).setOffset(35, 240 - 60 - 40);
          this.sound.play('land', { volume: 0.6 });
          this.dust.explode(10, s.x, st.groundY);
          this.burst.setParticleTint(0xa99bff);
          this.burst.explode(5, s.x, st.groundY - 4);
          this.cam.shake(80, 0.004);
        }
      }
    }
    this.stals = this.stals.filter((s) => s.active);
  }

  generate() {
    const ahead = this.cam.scrollX + VW + 900;
    let guard = 0;
    while (this.gen.x < ahead && guard++ < 20) this.gen.next();
    if (this.pending && this.pending.x < this.cam.scrollX + VW + 500) this.flushGround();
  }

  cleanup() {
    const left = this.cam.scrollX - 300;
    if (!this.objects.length) return;
    const keep = [];
    for (const o of this.objects) {
      if (!o.active) continue;
      if (o.__right < left) {
        this.tweens.killTweensOf(o);
        o.destroy();
      } else keep.push(o);
    }
    this.objects = keep;
  }

  toast(text, color) {
    const t = this.toastText;
    t.setText(text).setColor(color).setAlpha(0).setY(130);
    this.tweens.killTweensOf(t);
    this.tweens.add({ targets: t, alpha: 1, y: 112, duration: 300, ease: 'Quad.out' });
    this.tweens.add({ targets: t, alpha: 0, duration: 500, delay: 1600 });
  }

  // ============================================================ menus
  pause() {
    if (this.paused || this.dead || this.overlay) return;
    this.paused = true;
    this.physics.world.pause();
    this.tweens.pauseAll();
    this.trail.pause();
    this.sound.getAll('music').forEach((m) => m.pause());

    const o = this.add.container(0, 0).setScrollFactor(0).setDepth(300);
    const dim = this.add.rectangle(0, 0, VW, VH, 0x05061a, 0.72).setOrigin(0).setInteractive();
    const t = label(this, VW / 2, VH * 0.3, 'PAUSA', 40, '200', COLORS.text, 18).setOrigin(0.5);
    const resume = pillButton(this, VW / 2, VH * 0.5, 'CONTINUAR', () => this.resume());
    const restart = pillButton(this, VW / 2 - 130, VH * 0.65, 'REINICIAR', () => this.restart(), { primary: false, w: 220 });
    const home = pillButton(this, VW / 2 + 130, VH * 0.65, this.spec ? 'ESTÚDIO' : 'MENU', () => (this.spec ? this.toStudio() : this.home()), { primary: false, w: 220 });
    const snd = soundToggle(this, VW - 48, 48);
    o.add([dim, t, resume, restart, home, snd]);
    this.pauseMenu = o;
  }

  resume() {
    if (!this.paused) return;
    this.pauseMenu?.destroy();
    this.pauseMenu = null;
    this.paused = false;
    this.physics.world.resume();
    this.tweens.resumeAll();
    this.trail.resume();
    this.sound.getAll('music').forEach((m) => m.resume());
    this.jumpHeld = false;
  }

  gameOver() {
    if (this.spec) return this.phaseOver(false);
    const dist = Math.floor(this.distance);
    const best = Math.max(dist, this.prevBest);
    const isRecord = dist > this.prevBest && this.prevBest > 0;
    save.set('best', best);
    save.set('totalGems', save.get('totalGems') + this.gemCount);
    save.set('bestGems', Math.max(save.get('bestGems'), this.gemCount));
    save.set('runs', save.get('runs') + 1);
    save.set('tutorialDone', true);

    const cx = VW / 2;
    const o = this.add.container(0, 0).setScrollFactor(0).setDepth(300);
    const dim = this.add.rectangle(0, 0, VW, VH, 0x05061a, 0.74).setOrigin(0).setInteractive();
    const head = label(this, cx, VH * 0.17, isRecord ? 'NOVO RECORDE' : 'FIM DA CORRIDA', 15, '500',
      isRecord ? COLORS.gold : COLORS.dim, 10).setOrigin(0.5);
    const big = label(this, cx, VH * 0.33, formatInt(dist), 96, '200', COLORS.text).setOrigin(0.5);
    const unit = label(this, cx, VH * 0.45, 'METROS', 12, '500', COLORS.dim, 8).setOrigin(0.5);

    const statY = VH * 0.56;
    const gemI = this.add.image(cx - 150, statY, 'gem').setScale(0.42);
    const gemT = label(this, cx - 128, statY, formatInt(this.gemCount), 24, '300', COLORS.text).setOrigin(0, 0.5);
    const sep = this.add.rectangle(cx, statY, 1, 28, 0xffffff, 0.25);
    const bestL = label(this, cx + 34, statY - 9, 'RECORDE', 10, '500', COLORS.dim, 5).setOrigin(0, 0.5);
    const bestT = label(this, cx + 34, statY + 10, `${formatInt(best)} m`, 18, '300', COLORS.text).setOrigin(0, 0.5);

    const again = pillButton(this, cx, VH * 0.73, 'JOGAR DE NOVO', () => this.restart(), { w: 260 });
    const home = iconButton(this, cx - 190, VH * 0.73, 'i_home', () => this.home(), 25);
    const snd = soundToggle(this, cx + 190, VH * 0.73);

    o.add([dim, head, big, unit, gemI, gemT, sep, bestL, bestT, again, home, snd]);
    o.setAlpha(0);
    this.tweens.add({ targets: o, alpha: 1, duration: 380 });
    [big, unit].forEach((e) => {
      e.y += 14;
      this.tweens.add({ targets: e, y: e.y - 14, duration: 520, ease: 'Cubic.out' });
    });
    if (isRecord) {
      this.sound.play('record', { volume: 0.5 });
      this.spark.setScrollFactor(0);
      this.time.addEvent({ delay: 120, repeat: 8, callback: () => this.spark.explode(4, cx + Phaser.Math.Between(-200, 200), VH * 0.33) });
    }
    this.overlay = o;
    this.hudDist.setAlpha(0.0);
    this.hudUnit.setAlpha(0.0);
  }

  showIntro() {
    const s = this.spec;
    const c = this.add.container(VW / 2, VH * 0.42).setScrollFactor(0).setDepth(90);
    const k = label(this, 0, -46, `FASE · ${theme(s.tema).nome.toUpperCase()}`, 12, '500', Phaser.Display.Color.IntegerToColor(this.tk.accent).rgba, 8).setOrigin(0.5);
    const t = label(this, 0, 0, s.nome, 46, '200', COLORS.text, 2).setOrigin(0.5);
    const f = label(this, 0, 48, s.frase, 15, '300', COLORS.dim, 1).setOrigin(0.5);
    c.add([k, t, f]);
    c.setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, duration: 500, delay: 250 });
    this.tweens.add({ targets: c, alpha: 0, y: c.y - 20, duration: 600, delay: 3000, onComplete: () => c.destroy() });
  }

  complete() {
    if (this.completed || this.dead) return;
    this.completed = true;
    this.progress = 1;
    this.progBar.width = this.progW;
    this.sound.play('record', { volume: 0.6 });
    this.flash.setFillStyle(this.tk.accent).setAlpha(0.3);
    this.tweens.add({ targets: this.flash, alpha: 0, duration: 600 });
    this.spark.explode(20, this.player.x, this.player.y);
    this.tweens.add({ targets: this.gfx, alpha: 0, scale: 0.9, duration: 700 });
    this.trail.stop();
    this.time.delayedCall(900, () => this.phaseOver(true));
  }

  result(completed) {
    return {
      spec: this.spec,
      completed,
      attempts: this.attempt,
      reason: completed ? null : this.deathReason,
      progress: completed ? 1 : this.progress || 0,
      gems: this.gemCount,
      gemsTotal: this.gen.gemsPlaced,
      seconds: Math.round(this.clock),
    };
  }

  phaseOver(completed) {
    if (this.overlay) return;
    const r = this.result(completed);
    this.registry.set('lastResult', r);
    recordPhaseResult(r);
    save.set('totalGems', save.get('totalGems') + this.gemCount);
    save.set('tutorialDone', true);
    this.physics.world.pause();

    const cx = VW / 2;
    const accent = Phaser.Display.Color.IntegerToColor(this.tk.accent).rgba;
    const o = this.add.container(0, 0).setScrollFactor(0).setDepth(300);
    const dim = this.add.rectangle(0, 0, VW, VH, 0x05061a, 0.76).setOrigin(0).setInteractive();
    const head = label(this, cx, VH * 0.16, completed ? 'FASE CONCLUÍDA' : `TENTATIVA ${this.attempt}`, 14, '500',
      completed ? accent : COLORS.dim, 10).setOrigin(0.5);
    const big = completed
      ? label(this, cx, VH * 0.31, this.spec.nome, 60, '200', COLORS.text, 2).setOrigin(0.5)
      : label(this, cx, VH * 0.31, `${Math.round(r.progress * 100)}%`, 92, '200', COLORS.text).setOrigin(0.5);
    const sub = label(this, cx, VH * 0.42, completed ? `${r.seconds} s · ${r.attempts} tentativa${r.attempts > 1 ? 's' : ''}` : `DO CAMINHO · ${this.spec.nome.toUpperCase()}`,
      12, '500', COLORS.dim, 6).setOrigin(0.5);
    const statY = VH * 0.53;
    const gemI = this.add.image(cx - 34, statY, 'gem').setScale(0.42);
    const gemT = label(this, cx - 12, statY, `${r.gems} / ${r.gemsTotal}`, 22, '300', COLORS.text).setOrigin(0, 0.5);

    const items = [dim, head, big, sub, gemI, gemT];
    if (completed) {
      items.push(pillButton(this, cx, VH * 0.69, 'PRÓXIMA FASE', () => this.toStudio(true), { w: 280 }));
      items.push(pillButton(this, cx, VH * 0.82, 'REPETIR', () => this.retry(false), { primary: false, w: 200, h: 46 }));
    } else {
      items.push(pillButton(this, cx, VH * 0.69, 'TENTAR DE NOVO', () => this.retry(true), { w: 280 }));
      items.push(pillButton(this, cx, VH * 0.82, 'AJUSTAR COM IA', () => this.toStudio(false), { primary: false, w: 240, h: 46 }));
    }
    items.push(iconButton(this, cx - 220, VH * 0.69, 'i_home', () => this.home(), 25));
    items.push(soundToggle(this, cx + 220, VH * 0.69));
    o.add(items);
    o.setAlpha(0);
    this.tweens.add({ targets: o, alpha: 1, duration: 380 });
    this.overlay = o;
    [this.hudDist, this.hudUnit, this.progTrack, this.progBar, this.progGem].forEach((e) => e?.setAlpha(0));
  }

  retry(nextAttempt) {
    this.cam.fadeOut(260, 5, 6, 26);
    this.cam.once('camerafadeoutcomplete', () => this.scene.restart({ spec: this.spec, attempt: nextAttempt ? this.attempt + 1 : 1 }));
  }

  toStudio(next) {
    this.tweens.resumeAll();
    this.physics.world.resume();
    this.sound.getAll('music').forEach((m) => m.setRate(1));
    this.cam.fadeOut(300, 5, 6, 26);
    this.cam.once('camerafadeoutcomplete', () => this.scene.start('Studio', { result: this.registry.get('lastResult') || this.result(false), next }));
  }

  restart() {
    if (this.spec) return this.retry(true);
    this.cam.fadeOut(260, 5, 6, 26);
    this.cam.once('camerafadeoutcomplete', () => this.scene.restart());
  }

  home() {
    this.sound.getAll('music').forEach((m) => m.setRate(1));
    this.tweens.resumeAll();
    this.physics.world.resume();
    this.cam.fadeOut(300, 5, 6, 26);
    this.cam.once('camerafadeoutcomplete', () => this.scene.start('Title'));
  }
}
