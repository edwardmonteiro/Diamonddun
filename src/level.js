import { speedAt } from './config.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const Y_MIN = 470;
const Y_MAX = 630;
const AIR_T = 0.74; // seconds of a single jump

/**
 * Procedural level generator. Lays chunks ahead of the player, each one a
 * small, readable challenge, with breathing room scaled by difficulty.
 */
export class LevelGen {
  constructor(world, startX) {
    this.w = world;
    this.startX = startX;
    this.x = 0;
    this.y = 590;
    this.last = null;
    this.count = 0;
    this.lastDashReq = -1e9;
    this.wallsSeen = 0;
  }

  get d() {
    return clamp((this.x - this.startX) / 60000, 0, 1);
  }

  get S() {
    return speedAt(this.x - this.startX);
  }

  // ------------------------------------------------------------- helpers --
  run(len, gems = false) {
    this.w.ground(this.x, len, this.y, false);
    if (gems) {
      const n = Math.floor(len / 64);
      for (let i = 1; i < n; i++) if (i % 2 === 0 || n < 5) this.w.gem(this.x + i * 64, this.y - 44);
    }
    this.x += len;
  }

  landing(len, newY) {
    this.y = newY;
    this.w.ground(this.x, len, this.y, true);
    this.x += len;
  }

  arc(x0, y0, x1, y1, h, n) {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t - 4 * h * t * (1 - t);
      this.w.gem(x, y);
    }
  }

  // ---------------------------------------------------------------- chunks --
  chunks() {
    const d = this.d;
    const canDash = this.x - this.lastDashReq > this.S * 2.2;
    return [
      { id: 'flat', w: 0.7 },
      { id: 'gap', w: 1.3 },
      { id: 'spikes', w: 1.3 },
      { id: 'steps', w: d > 0.03 ? 0.8 : 0 },
      { id: 'sawLow', w: d > 0.06 ? 0.9 : 0 },
      { id: 'sawHigh', w: d > 0.1 ? 0.7 : 0 },
      { id: 'wall', w: d > 0.04 && canDash ? 0.9 : 0 },
      { id: 'stal', w: d > 0.14 ? 0.8 : 0 },
      { id: 'laser', w: d > 0.2 && canDash ? 0.8 : 0 },
      { id: 'crumble', w: d > 0.25 ? 0.8 : 0 },
      { id: 'bigGap', w: d > 0.3 ? 0.7 : 0 },
      { id: 'sawMove', w: d > 0.4 ? 0.8 : 0 },
      { id: 'combo', w: d > 0.55 ? 1.0 : 0 },
    ];
  }

  start(x) {
    this.x = x - 400;
    this.run(1500, false);
    // first, gentle diamonds to teach the joy of collecting
    this.arc(this.x - 600, this.y - 44, this.x - 200, this.y - 44, 0, 6);
  }

  next() {
    const list = this.chunks().filter((c) => c.w > 0 && c.id !== this.last);
    // early game: ease in with a scripted sequence
    const script = ['gap', 'spikes', 'gap', 'wall', 'spikes', 'steps'];
    let id;
    if (this.count < script.length) id = script[this.count];
    else {
      const total = list.reduce((s, c) => s + c.w, 0);
      let r = Math.random() * total;
      id = list.find((c) => (r -= c.w) < 0)?.id || 'flat';
    }
    if (id === 'wall' && !(this.x - this.lastDashReq > this.S * 2.2)) id = 'spikes';
    this.last = id;
    this.count++;
    this[id]();
    // breathing room shrinks with difficulty
    const rest = Math.round(this.S * rnd(0.55, 0.85) * (1.15 - this.d * 0.55));
    this.drift();
    this.run(rest, Math.random() < 0.35);
  }

  drift() {
    // gentle terrain undulation between chunks
    const r = Math.random();
    if (r < 0.25 && this.y > Y_MIN + 40) {
      // step up: needs a hop, telegraphed by diamonds
      const up = Math.round(rnd(40, 75));
      this.run(120);
      this.arc(this.x - 60, this.y - 40, this.x + 80, this.y - up - 40, 70, 4);
      this.landing(160, this.y - up);
    } else if (r < 0.55 && this.y < Y_MAX - 40) {
      const down = Math.round(rnd(40, 100));
      this.landing(140, clamp(this.y + down, Y_MIN, Y_MAX));
    }
  }

  flat() {
    this.run(Math.round(rnd(380, 620)), true);
  }

  gap() {
    const S = this.S;
    this.run(180);
    const g = Math.round(clamp(S * AIR_T * rnd(0.45, 0.62), 140, 420));
    const dy = Math.random() < 0.5 ? 0 : Math.round(rnd(-50, 70));
    const ny = clamp(this.y + dy, Y_MIN, Y_MAX);
    this.arc(this.x - 40, this.y - 50, this.x + g + 40, ny - 50, 150, 5);
    this.x += g;
    this.landing(220, ny);
  }

  bigGap() {
    const S = this.S;
    this.run(200);
    const g = Math.round(clamp(S * AIR_T * rnd(0.95, 1.15), 340, 720));
    this.arc(this.x - 30, this.y - 60, this.x + g + 30, this.y - 60, 260, 9);
    this.w.hint(this.x + g / 2, this.y - 330, 'PULO DUPLO');
    this.x += g;
    this.landing(260, this.y);
  }

  spikes() {
    const n = this.d > 0.45 ? pick([1, 2, 3]) : this.d > 0.15 ? pick([1, 2]) : 1;
    this.run(220);
    const w = 60 * n;
    for (let i = 0; i < n; i++) this.w.spikes(this.x + 30 + i * 60, this.y);
    this.arc(this.x - 60, this.y - 50, this.x + w + 60, this.y - 50, 140, 5);
    this.run(w + 60);
  }

  steps() {
    const S = this.S;
    this.run(160);
    const gap = Math.round(clamp(S * 0.32, 110, 220));
    let px = this.x + gap;
    const heights = [70, 140, 80];
    heights.forEach((h) => {
      const w = 180;
      this.w.plat(px, this.y - h, w, false);
      this.w.gem(px + 50, this.y - h - 44);
      this.w.gem(px + 130, this.y - h - 44);
      px += w + gap;
    });
    this.x = px;
    this.landing(220, this.y);
  }

  sawLow() {
    this.run(240);
    this.w.saw(this.x + 40, this.y + 6, {});
    this.arc(this.x - 60, this.y - 50, this.x + 140, this.y - 50, 160, 5);
    this.run(200);
  }

  sawHigh() {
    // a saw hovering just above head height: stay low and collect underneath
    this.run(160);
    this.w.saw(this.x + 120, this.y - 132, {});
    for (let i = 0; i < 5; i++) this.w.gem(this.x + i * 60, this.y - 36);
    this.run(320);
  }

  sawMove() {
    this.run(220);
    this.w.saw(this.x + 60, this.y - 40, { move: true, range: 190, period: rnd(1300, 1700) });
    this.run(260, true);
  }

  wall() {
    this.run(300);
    this.w.wall(this.x, this.y);
    for (let i = -2; i <= 3; i++) this.w.gem(this.x + i * 56, this.y - 44);
    if (this.wallsSeen++ < 2) this.w.hint(this.x, this.y - 290, 'DASH');
    this.lastDashReq = this.x;
    this.run(360);
  }

  stal() {
    const n = this.d > 0.5 ? 3 : 2;
    this.run(200);
    for (let i = 0; i < n; i++) {
      this.w.stal(this.x + 140, this.y);
      this.w.gem(this.x + 40, this.y - 44);
      this.w.gem(this.x + 260, this.y - 44);
      this.run(320);
    }
  }

  laser() {
    this.run(280);
    this.w.laser(this.x, this.y, { period: rnd(1500, 1900), on: 0.45 });
    this.lastDashReq = this.x;
    for (let i = -1; i <= 2; i++) this.w.gem(this.x + i * 60, this.y - 44);
    this.run(320);
  }

  crumble() {
    const S = this.S;
    this.run(170);
    const g1 = Math.round(clamp(S * AIR_T * 0.42, 120, 280));
    this.x += g1;
    const pw = 200;
    this.w.plat(this.x, this.y - 50, pw, true);
    this.arc(this.x + 20, this.y - 94, this.x + pw - 20, this.y - 94, 0, 3);
    this.x += pw;
    const g2 = Math.round(clamp(S * AIR_T * 0.5, 140, 320));
    this.arc(this.x, this.y - 110, this.x + g2, this.y - 60, 120, 4);
    this.x += g2;
    this.landing(220, this.y);
  }

  combo() {
    // two hazards back to back with a tight gap
    const a = pick(['spikes', 'sawLow', 'gap']);
    let b = pick(['spikes', 'gap', 'stal', 'sawLow']);
    if (b === a) b = 'flat';
    this[a]();
    this.run(Math.round(this.S * 0.45));
    this[b]();
  }
}
