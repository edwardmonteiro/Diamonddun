/**
 * Cristal DS — rules. The contract between "whatever the AI wrote" and
 * "a phase that is fair, readable and finishable".
 *
 *   SPEC_SCHEMA  — JSON schema the local model is constrained to (grammar)
 *   normalizeSpec(raw, constraints) → { spec, fixes }
 *       every fix is a human-readable note shown in the studio, so the
 *       guardrails are visible instead of silently rewriting the AI.
 */
import { PIECE, PIECE_IDS } from './components.js';
import { THEME_IDS } from './tokens.js';

export const LIMITS = { minPieces: 5, maxPieces: 20, nameMax: 28, phraseMax: 90 };

/** Base run speed (px/s) per `velocidade` level. */
export const SPEEDS = [0, 360, 420, 490, 570, 650];

export const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    nome: { type: 'string', maxLength: LIMITS.nameMax },
    tema: { type: 'string', enum: THEME_IDS },
    velocidade: { type: 'integer', enum: [1, 2, 3, 4, 5] },
    diamantes: { type: 'integer', enum: [1, 2, 3] },
    pecas: {
      type: 'array',
      items: { type: 'string', enum: PIECE_IDS },
      minItems: LIMITS.minPieces,
      maxItems: LIMITS.maxPieces,
    },
    frase: { type: 'string', maxLength: LIMITS.phraseMax },
  },
  required: ['nome', 'tema', 'velocidade', 'diamantes', 'pecas', 'frase'],
  additionalProperties: false,
};

const clampInt = (v, a, b, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d;
};

export const strip = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

/** Map loose model output ("Serra alta", "lasers") onto catalog ids. */
export function resolvePiece(token) {
  const t = strip(token).replace(/[\s-]+/g, '_');
  if (PIECE[t]) return t;
  const singular = t.replace(/s$/, '');
  if (PIECE[singular]) return singular;
  const hit = PIECE_IDS.find((id) => t.startsWith(id) || id.startsWith(t));
  return hit || null;
}

/**
 * @param raw          parsed JSON from a director (may be partial / sloppy)
 * @param constraints  hard constraints parsed from the player's own words:
 *                     { exclude:Set, only:Set|null, theme:string|null, speed:number|null }
 */
export function normalizeSpec(raw, constraints = {}) {
  const fixes = [];
  const r = raw && typeof raw === 'object' ? raw : {};
  const c = { exclude: new Set(), only: null, theme: null, speed: null, ...constraints };

  let tema = THEME_IDS.includes(strip(r.tema)) ? strip(r.tema) : null;
  if (!tema) {
    tema = c.theme || 'aurora';
    if (r.tema) fixes.push(`tema "${r.tema}" desconhecido → ${tema}`);
  }
  if (c.theme && tema !== c.theme) {
    fixes.push(`tema ajustado para ${c.theme}, como você pediu`);
    tema = c.theme;
  }

  let velocidade = clampInt(r.velocidade, 1, 5, 3);
  if (c.speed && velocidade !== c.speed) {
    fixes.push(`velocidade ${velocidade} → ${c.speed}, como você pediu`);
    velocidade = c.speed;
  }
  const diamantes = clampInt(r.diamantes, 1, 3, 2);

  // ---- pieces
  const rawList = Array.isArray(r.pecas) ? r.pecas : [];
  let pecas = [];
  let unknown = 0;
  for (const tok of rawList) {
    const id = resolvePiece(tok);
    if (id) pecas.push(id);
    else unknown++;
  }
  if (unknown) fixes.push(`${unknown} peça(s) fora do catálogo removida(s)`);

  const allowed = (id) => !c.exclude.has(id) && (!c.only || c.only.has(id) || PIECE[id].dif === 0);
  const before = pecas.length;
  pecas = pecas.filter(allowed);
  if (pecas.length < before) fixes.push(`${before - pecas.length} peça(s) que você vetou removida(s)`);

  if (pecas.length > LIMITS.maxPieces) {
    pecas = pecas.slice(0, LIMITS.maxPieces);
    fixes.push(`fase encurtada para ${LIMITS.maxPieces} peças`);
  }
  if (pecas.length < LIMITS.minPieces) {
    const pool = (c.only ? [...c.only] : ['buraco', 'espinhos', 'degraus', 'serra']).filter(allowed);
    const fill = pool.length ? pool : ['respiro'];
    let i = 0;
    while (pecas.length < LIMITS.minPieces) pecas.push(fill[i++ % fill.length]);
    fixes.push('fase completada até o mínimo de peças');
  }

  // ---- fairness passes (each one is a visible guardrail)
  const out = [];
  let hardRun = 0;
  const maxHard = velocidade >= 4 ? 2 : 3;
  let restsAdded = 0;
  let dashSplits = 0;
  pecas.forEach((id, i) => {
    const p = PIECE[id];
    if (i === 0 && p.dif >= 2) {
      out.push('respiro');
      restsAdded++;
    }
    const prev = out[out.length - 1];
    if (prev && PIECE[prev].dash && p.dash) {
      out.push('respiro');
      dashSplits++;
      hardRun = 0;
    }
    if (p.dif >= 2) {
      if (hardRun >= maxHard) {
        out.push('respiro');
        restsAdded++;
        hardRun = 0;
      }
      hardRun++;
    } else if (p.dif === 0) hardRun = 0;
    out.push(id);
  });
  if (restsAdded) fixes.push(`${restsAdded} respiro(s) para dar ritmo`);
  if (dashSplits) fixes.push('dash precisa recarregar: separei peças de dash seguidas');
  pecas = out;

  let nome = String(r.nome || '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.nameMax);
  if (!nome) nome = `${THEME_LABEL[tema]} ${pecas.length}`;
  let frase = String(r.frase || '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.phraseMax);
  if (!frase) frase = 'Boa corrida.';

  const spec = { v: 1, nome, tema, velocidade, diamantes, pecas, frase };
  return { spec, fixes, stats: specStats(spec) };
}

const THEME_LABEL = { aurora: 'Aurora', rosa: 'Rosa', gelo: 'Gelo', ouro: 'Ouro', esmeralda: 'Esmeralda', abismo: 'Abismo' };

/** Difficulty 1–5 and rough duration, for the blueprint card. */
export function specStats(spec) {
  const difs = spec.pecas.map((id) => PIECE[id]?.dif ?? 1);
  const avg = difs.reduce((a, b) => a + b, 0) / Math.max(1, difs.length);
  const dash = spec.pecas.filter((id) => PIECE[id]?.dash).length;
  const score = 0.6 * spec.velocidade + 1.25 * avg + 0.15 * dash + spec.pecas.length * 0.03;
  const dificuldade = Math.max(1, Math.min(5, Math.round(score - 0.4)));
  const seconds = Math.round(spec.pecas.length * (1.9 - spec.velocidade * 0.12) + 3);
  return { dificuldade, segundos: seconds };
}
