/**
 * Cristal DS — level components ("peças").
 *
 * Each piece is a small, readable challenge the level compiler knows how to
 * lay out safely. The AI only ever chooses ids from this catalog; geometry,
 * spacing and fairness are owned by the compiler (see rules.js / level.js).
 *
 *   id       — token the AI writes (Portuguese, so small models map requests easily)
 *   gen      — LevelGen method that builds it
 *   nome     — label in the studio
 *   ajuda    — one-line meaning, also fed to the model prompt
 *   dif      — difficulty weight (0 = rest, 3 = hard)
 *   dash     — needs the dash ability
 *   tags     — words that make the quick (non-LLM) director pick it
 *   glyph    — 24×24 SVG path data for the studio chip
 */
export const PIECES = [
  {
    id: 'respiro', gen: 'flat', nome: 'Respiro', dif: 0,
    ajuda: 'trecho plano e seguro com diamantes',
    tags: ['respiro', 'calma', 'tranquil', 'descanso', 'plano', 'reto'],
    glyph: 'M3 16h18',
  },
  {
    id: 'diamantes', gen: 'gemRain', nome: 'Chuva de diamantes', dif: 0,
    ajuda: 'arcos cheios de diamantes para coletar',
    tags: ['diamante', 'joia', 'tesouro', 'coleta', 'brilho', 'gema', 'bonus'],
    glyph: 'M7 7h10l3 4-8 9-8-9z',
  },
  {
    id: 'buraco', gen: 'gap', nome: 'Buraco', dif: 1,
    ajuda: 'vão curto, um pulo',
    tags: ['buraco', 'pulo', 'pular', 'salto', 'vao', 'fenda'],
    glyph: 'M2 16h7M15 16h7M9 16v5M15 16v5',
  },
  {
    id: 'abismo', gen: 'bigGap', nome: 'Abismo', dif: 2,
    ajuda: 'vão longo, exige pulo duplo',
    tags: ['abismo', 'precipicio', 'pulo duplo', 'vao grande', 'queda', 'voo', 'voar'],
    glyph: 'M1 16h5M18 16h5M6 16v6M18 16v6M8 10q4-6 8 0',
  },
  {
    id: 'espinhos', gen: 'spikes', nome: 'Espinhos', dif: 1,
    ajuda: 'cristais pontudos no chão',
    tags: ['espinho', 'ponta', 'estaca', 'cravo', 'cristal pontudo'],
    glyph: 'M3 19l3-9 3 9 3-12 3 12 3-9 3 9z',
  },
  {
    id: 'degraus', gen: 'steps', nome: 'Degraus', dif: 1,
    ajuda: 'plataformas flutuantes em escada',
    tags: ['degrau', 'plataforma', 'escada', 'subir', 'altura', 'flutuante'],
    glyph: 'M3 19h5M9 14h5M15 9h6',
  },
  {
    id: 'serra', gen: 'sawLow', nome: 'Serra', dif: 1,
    ajuda: 'serra girando no chão',
    tags: ['serra', 'lamina', 'disco', 'giratori'],
    glyph: 'M12 4l2 3 3-1 0 3 3 2-3 2 0 3-3-1-2 3-2-3-3 1 0-3-3-2 3-2 0-3 3 1z',
  },
  {
    id: 'serra_alta', gen: 'sawHigh', nome: 'Serra alta', dif: 1,
    ajuda: 'serra suspensa: fique no chão',
    tags: ['serra alta', 'suspensa', 'teto', 'abaixar', 'rasteiro'],
    glyph: 'M12 2l2 3 3 0-1 3 2 2-3 1-1 3-2-2-2 2-1-3-3-1 2-2-1-3 3 0zM3 20h18',
  },
  {
    id: 'serra_movel', gen: 'sawMove', nome: 'Serra móvel', dif: 2,
    ajuda: 'serra que sobe e desce, espere o tempo',
    tags: ['serra movel', 'sobe e desce', 'elevador', 'timing', 'ritmo', 'movel'],
    glyph: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4',
  },
  {
    id: 'parede', gen: 'wall', nome: 'Parede de cristal', dif: 2, dash: true,
    ajuda: 'muro de cristal, quebre com dash',
    tags: ['parede', 'muro', 'dash', 'quebrar', 'barreira', 'vidro'],
    glyph: 'M10 2h4v20h-4zM4 12h4M5 9l3 3-3 3',
  },
  {
    id: 'estalactite', gen: 'stal', nome: 'Estalactites', dif: 2,
    ajuda: 'pontas que despencam do teto',
    tags: ['estalactite', 'teto', 'cair', 'caindo', 'chuva de pedra', 'gelo'],
    glyph: 'M4 3h16l-3 4-2 9-2-9-2 6-2-6-2 3z',
  },
  {
    id: 'laser', gen: 'laser', nome: 'Laser', dif: 2, dash: true,
    ajuda: 'feixe que liga e desliga, atravesse com dash',
    tags: ['laser', 'feixe', 'raio', 'luz', 'energia', 'neon'],
    glyph: 'M12 2v4M12 18v4M12 8v8M9 2h6M9 22h6',
  },
  {
    id: 'ruina', gen: 'crumble', nome: 'Plataforma ruína', dif: 2,
    ajuda: 'plataforma que desmorona ao pisar',
    tags: ['ruina', 'desmorona', 'quebradica', 'cai', 'fragil', 'desaba'],
    glyph: 'M3 12h18M7 12l-1 4M12 12l1 5M17 12l-1 3',
  },
];

export const PIECE_IDS = PIECES.map((p) => p.id);
export const PIECE = Object.fromEntries(PIECES.map((p) => [p.id, p]));

/** Default pool when the player asks for "anything". */
export const STARTER_POOL = ['buraco', 'espinhos', 'degraus', 'serra', 'parede'];

/** Inline SVG markup for a piece glyph (studio chips, blueprint strip). */
export function glyphSvg(id, size = 22) {
  const p = PIECE[id];
  if (!p) return '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${p.glyph}"/></svg>`;
}
