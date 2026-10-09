/**
 * Quick director — deterministic, instant, offline. Turns intent into a
 * phase spec with a designed difficulty curve (warm-up → build → climax).
 * It is the fallback whenever the local model is missing or misbehaves.
 */
import { PIECES, PIECE } from '../ds/components.js';
import { deathPiece } from './intent.js';

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = {
  aurora: ['Vale da Aurora', 'Céu Boreal', 'Trilha Ciano', 'Cristal Azul'],
  rosa: ['Noite Rosa', 'Neon Magenta', 'Jardim de Quartzo', 'Rosa dos Ventos'],
  gelo: ['Ponte de Gelo', 'Glaciar', 'Vento Polar', 'Espelho Branco'],
  ouro: ['Cânion Dourado', 'Pôr do Sol', 'Mina de Ouro', 'Dunas de Âmbar'],
  esmeralda: ['Selva Esmeralda', 'Gruta Verde', 'Musgo Brilhante', 'Raiz de Jade'],
  abismo: ['Abismo Rubro', 'Fenda Vulcânica', 'Coração de Lava', 'Noite Sem Fim'],
};
const SUFFIX = {
  serra: 'das Serras', serra_alta: 'das Lâminas', serra_movel: 'do Ritmo', laser: 'dos Lasers', parede: 'de Vidro',
  estalactite: 'das Pontas', abismo: 'do Vazio', buraco: 'dos Saltos', espinhos: 'dos Espinhos', degraus: 'dos Degraus',
  ruina: 'em Ruínas', diamantes: 'do Tesouro',
};
const PHRASES = [
  'Respire, olhe longe e confie no pulo duplo.',
  'O dash recarrega rápido. Use sem medo.',
  'Diamantes marcam o caminho seguro.',
  'Ritmo primeiro, velocidade depois.',
  'Cada cristal quebrado é um passo à frente.',
  'O chão some quando você hesita.',
];

/**
 * @param intent  from parseIntent()
 * @param prev    last result (optional) — adapts the next phase to the player
 */
export function quickSpec(intent, prev = null, seed = Date.now()) {
  const rng = mulberry(seed);
  let speed = intent.speed;
  let diff = intent.difficulty;
  const w = {};
  for (const p of PIECES) w[p.id] = p.dif === 0 ? 0 : 1;

  // unlocked pieces grow with ambition; easy phases stay readable
  const tier = diff === 'dificil' ? 3 : diff === 'facil' ? 1 : 2;
  for (const p of PIECES) if (p.dif > tier) w[p.id] = 0.25;

  // adapt to the previous attempt when the player just says "next"
  // only a generic request ("próxima", "mais difícil", empty) inherits from the last phase;
  // a fully described phase starts fresh
  const described = intent.theme || intent.only || intent.length || Object.keys(intent.weights).length;
  if (prev?.spec && (!described || intent.next)) {
    const ps = prev.spec;
    if (speed == null) {
      if (prev.completed && prev.attempts <= 2) speed = Math.min(5, ps.velocidade + 1);
      else if (!prev.completed && (prev.attempts >= 2 || prev.progress < 0.5)) speed = Math.max(1, ps.velocidade - 1);
      else speed = ps.velocidade;
    }
    if (diff === 'facil') speed = Math.min(speed, Math.max(1, ps.velocidade - 1));
    if (diff === 'dificil') speed = Math.max(speed, Math.min(5, ps.velocidade + 1));
    if (!intent.theme && intent.next) intent = { ...intent, theme: pick(rng, Object.keys(NAMES).filter((t) => t !== ps.tema)) };
    const dp = deathPiece(prev.reason);
    if (!prev.completed && dp && w[dp] > 0) w[dp] *= 0.5;
    if (prev.completed) {
      // introduce something the player has not faced yet
      const fresh = PIECES.filter((p) => p.dif > 0 && !ps.pecas.includes(p.id));
      if (fresh.length) w[pick(rng, fresh).id] = 2.5;
    }
  }

  // pieces the player named dominate; everything else becomes seasoning
  const named = Object.entries(intent.weights).filter(([, m]) => m > 1);
  if (named.length) for (const id of Object.keys(w)) if (!intent.weights[id]) w[id] *= 0.7;
  for (const [id, m] of Object.entries(intent.weights)) w[id] = Math.max(w[id] || 0, 1) * (m >= 3 ? 3.5 : m > 1 ? 2.2 : m);
  // asking for "serras" covers the whole saw family
  if (intent.weights.serra >= 2) ['serra_alta', 'serra_movel'].forEach((id) => (w[id] = Math.max(w[id], intent.weights.serra)));
  for (const id of intent.exclude) w[id] = 0;
  if (intent.only) for (const id of Object.keys(w)) if (!intent.only.has(id)) w[id] = 0;

  if (speed == null) speed = diff === 'facil' ? 2 : diff === 'dificil' ? 4 : 3;
  const n = intent.length ?? (diff === 'dificil' ? 14 : diff === 'facil' ? 8 : 11);
  const gems = intent.gems ?? (diff === 'facil' ? 3 : 2);

  const pool = Object.entries(w).filter(([, v]) => v > 0);
  if (!pool.length) pool.push(['buraco', 1], ['espinhos', 1]);
  const draw = (maxDif) => {
    const cands = pool.filter(([id]) => PIECE[id].dif <= maxDif);
    const list = cands.length ? cands : pool;
    const total = list.reduce((s, [, v]) => s + v, 0);
    let r = rng() * total;
    for (const [id, v] of list) if ((r -= v) < 0) return id;
    return list[0][0];
  };

  const pecas = [];
  let last = null;
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    const cap = t < 0.25 ? 1 : t < 0.7 ? 2 : 3; // warm-up → build → climax
    let id = draw(cap);
    for (let k = 0; k < 4 && id === last && pool.length > 1; k++) id = draw(cap);
    pecas.push(id);
    last = id;
    if (gems === 3 && i % 4 === 3 && i < n - 1 && id !== 'diamantes') {
      pecas.push('diamantes');
      last = 'diamantes';
    }
  }

  const tema = intent.theme || (prev?.spec?.tema && !intent.next ? prev.spec.tema : pick(rng, ['aurora', 'rosa', 'gelo', 'ouro', 'esmeralda']));
  const counts = {};
  pecas.forEach((id) => (counts[id] = (counts[id] || 0) + (PIECE[id].dif ? 1 + PIECE[id].dif * 0.1 : 0)));
  const star = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  let nome = pick(rng, NAMES[tema] || NAMES.aurora);
  if (star && SUFFIX[star] && rng() < 0.6) nome = `${nome.split(' ')[0]} ${SUFFIX[star]}`;

  return { nome, tema, velocidade: speed, diamantes: gems, pecas, frase: pick(rng, PHRASES) };
}
