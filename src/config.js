// Logical world is always 720 units tall; width follows the screen aspect.
export const VH = 720;

function computeSize() {
  const w = Math.max(window.innerWidth, window.innerHeight);
  const h = Math.min(window.innerWidth, window.innerHeight);
  const aspect = Math.min(Math.max(w / h, 1.5), 2.4);
  const VW = Math.round(VH * aspect);
  const dpr = window.devicePixelRatio || 1;
  // Render at device resolution (capped) and zoom the cameras, so text and edges stay crisp.
  const zoom = Math.min(Math.max((h * dpr) / VH, 1), 1.5);
  return { VW, zoom, CW: Math.round(VW * zoom), CH: Math.round(VH * zoom) };
}

export const SIZE = computeSize();
export const VW = SIZE.VW;

export const FONT = "'Outfit', system-ui, sans-serif";

export const COLORS = {
  ink: '#05061a',
  text: '#eef3ff',
  dim: '#9aa3d6',
  cyan: '#6eebff',
  pink: '#ff7ad9',
  gold: '#ffe08a',
};

export const PHYS = {
  gravity: 2600,
  jump: 960,
  djump: 860,
  baseSpeed: 430,
  maxSpeed: 780,
  rampDistance: 90000, // px until max speed
  dashTime: 0.22,
  dashBoost: 640,
  dashCooldown: 1.1,
  coyote: 0.09,
  buffer: 0.13,
};

export const PX_PER_M = 40;

export function speedAt(x) {
  const t = Math.min(Math.max(x / PHYS.rampDistance, 0), 1);
  const s = t * t * (3 - 2 * t);
  return PHYS.baseSpeed + (PHYS.maxSpeed - PHYS.baseSpeed) * (0.75 * t + 0.25 * s);
}

/** Apply the shared camera set-up (zoom from the top-left corner). */
export function setupCamera(scene) {
  const cam = scene.cameras.main;
  cam.setOrigin(0, 0);
  cam.setZoom(SIZE.zoom);
  cam.setBackgroundColor(COLORS.ink);
  return cam;
}
