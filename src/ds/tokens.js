/**
 * Cristal DS — design tokens shared by the Phaser game and the HTML studio.
 *
 * Three layers:
 *   1. core   — type, spacing, radii, motion (never change per phase)
 *   2. theme  — palette tokens a phase can switch (the AI picks one by id)
 *   3. css    — the same tokens exported as CSS custom properties
 */

export const core = {
  font: "'Outfit', system-ui, sans-serif",
  weight: { thin: 200, light: 300, medium: 500, bold: 700 },
  size: { xs: 11, sm: 13, md: 16, lg: 22, xl: 34, xxl: 64 },
  space: [0, 4, 8, 12, 16, 24, 32, 48, 64],
  radius: { sm: 8, md: 14, pill: 999 },
  tracking: { label: '0.32em', title: '0.18em' },
  motion: { fast: 120, base: 240, slow: 480, ease: 'cubic-bezier(.2,.8,.2,1)' },
  ink: '#05061a',
  text: '#eef3ff',
  dim: '#9aa3d6',
  line: 'rgba(255,255,255,0.14)',
  surface: 'rgba(14,14,44,0.62)',
};

const hex = (s) => parseInt(s.slice(1), 16);

/**
 * Phase themes. Tints multiply the shared painted backdrop, so a single set of
 * art reads as six different worlds. `music` nudges the soundtrack rate.
 */
export const THEMES = {
  aurora: {
    nome: 'Aurora',
    accent: '#6eebff', hazard: '#ff4fa5', gem: '#6eebff',
    sky: '#ffffff', far: '#ffffff', mid: '#ffffff', near: '#ffffff', mist: '#ffffff',
    ground: '#ffffff', music: 1.0,
  },
  rosa: {
    nome: 'Noite Rosa',
    accent: '#ff8ad9', hazard: '#ffd166', gem: '#ffb3ea',
    sky: '#ffc4e6', far: '#ffb0d8', mid: '#ff9fd0', near: '#ffc0e0', mist: '#ff9fd8',
    ground: '#ffb8e0', music: 1.03,
  },
  gelo: {
    nome: 'Gelo',
    accent: '#bff6ff', hazard: '#ff6b8a', gem: '#e6fdff',
    sky: '#d6f4ff', far: '#cfeeff', mid: '#bfe9ff', near: '#d8f1ff', mist: '#e8f8ff',
    ground: '#cdeeff', music: 0.97,
  },
  ouro: {
    nome: 'Ouro',
    accent: '#ffd479', hazard: '#ff5f6d', gem: '#ffe7a3',
    sky: '#ffd9b0', far: '#ffc89a', mid: '#ffcf8f', near: '#ffd6a0', mist: '#ffc98a',
    ground: '#ffd8a0', music: 1.02,
  },
  esmeralda: {
    nome: 'Esmeralda',
    accent: '#6dffb5', hazard: '#ff7a59', gem: '#b6ffd9',
    sky: '#c4ffe4', far: '#a8f5d0', mid: '#9cf0c8', near: '#b9f7d8', mist: '#a6f2cf',
    ground: '#a8f0cc', music: 0.99,
  },
  abismo: {
    nome: 'Abismo',
    accent: '#ff5d5d', hazard: '#ffb347', gem: '#ffd1d1',
    sky: '#ff9a9a', far: '#d97a8e', mid: '#c96a80', near: '#a05a70', mist: '#ff6f6f',
    ground: '#ff9aa5', music: 0.94,
  },
};

export const THEME_IDS = Object.keys(THEMES);

export function theme(id) {
  return THEMES[id] || THEMES.aurora;
}

/** Phaser-friendly numeric versions of a theme's colours. */
export function themeHex(id) {
  const t = theme(id);
  const out = {};
  for (const [k, v] of Object.entries(t)) out[k] = typeof v === 'string' && v.startsWith('#') ? hex(v) : v;
  return out;
}

/** Inject core + theme tokens as CSS custom properties. */
export function applyCssTokens(themeId = 'aurora', root = document.documentElement) {
  const t = theme(themeId);
  const vars = {
    '--ds-font': core.font,
    '--ds-ink': core.ink,
    '--ds-text': core.text,
    '--ds-dim': core.dim,
    '--ds-line': core.line,
    '--ds-surface': core.surface,
    '--ds-accent': t.accent,
    '--ds-hazard': t.hazard,
    '--ds-gem': t.gem,
    '--ds-r-sm': `${core.radius.sm}px`,
    '--ds-r-md': `${core.radius.md}px`,
    '--ds-track': core.tracking.label,
    '--ds-ease': core.motion.ease,
    '--ds-fast': `${core.motion.fast}ms`,
    '--ds-base': `${core.motion.base}ms`,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}
