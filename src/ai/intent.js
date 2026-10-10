/**
 * Reads the player's request (Portuguese, casual) into structured intent.
 * Used two ways:
 *   - as hard constraints on whatever the LLM produces (vetoes, "só X", tema)
 *   - as the whole brain of the quick director when the LLM is off
 */
import { PIECES, PIECE } from '../ds/components.js';
import { strip } from '../ds/rules.js';

const THEME_WORDS = {
  rosa: ['rosa', 'pink', 'magenta', 'romant', 'neon rosa'],
  gelo: ['gelo', 'neve', 'frio', 'congel', 'inverno', 'glacial', 'polar', 'branc'],
  ouro: ['ouro', 'dourad', 'sol', 'por do sol', 'entardecer', 'deserto', 'amarel', 'quente'],
  esmeralda: ['esmeralda', 'verde', 'floresta', 'selva', 'mata', 'natureza', 'jade'],
  abismo: ['abismo', 'vermelh', 'inferno', 'lava', 'fogo', 'escur', 'sombri', 'terror', 'sangue', 'vulcao'],
  aurora: ['aurora', 'azul', 'ciano', 'classic', 'original', 'boreal'],
};

const NEG = /(sem|nada de|nenhum|nenhuma|nao quero|nao|evite|evita|tira|tirar|chega de|zero)\s+(?:\w+\s+){0,2}$/;
const ONLY = /(so|apenas|somente|soh|exclusivamente)\s+(?:\w+\s+){0,2}$/;
const MORE = /(mais|muito|muita|muitos|muitas|cheio de|cheia de|varios|varias|bastante|monte de|chuva de)\s+(?:\w+\s+){0,1}$/;
const LESS = /(menos|pouco|pouca|poucos|poucas)\s+(?:\w+\s+){0,1}$/;

function findTag(text, tag) {
  const hits = [];
  let i = text.indexOf(tag);
  while (i >= 0) {
    hits.push(i);
    i = text.indexOf(tag, i + tag.length);
  }
  return hits;
}

export function parseIntent(request) {
  const text = ` ${strip(request).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')} `;
  const intent = {
    text: text.trim(),
    theme: null,
    speed: null,
    difficulty: null, // 'facil' | 'medio' | 'dificil'
    length: null, // pieces
    gems: null,
    weights: {}, // piece id -> multiplier
    exclude: new Set(),
    only: null,
    next: /proxim|continu|seguinte|outra fase|nova fase|mais uma/.test(text),
  };

  for (const [id, words] of Object.entries(THEME_WORDS)) {
    if (words.some((w) => text.includes(` ${w}`))) {
      intent.theme = id;
      break;
    }
  }

  if (/(devagar|lent|calm|tranquil|relax|zen|suave)/.test(text)) intent.speed = 1;
  if (/(rapid|veloz|turbo|acelerad|correria|alta velocidade|voando|sonic)/.test(text)) intent.speed = 5;
  const vnum = text.match(/velocidade (\d)/);
  if (vnum) intent.speed = Math.max(1, Math.min(5, +vnum[1]));

  if (/(facil|iniciante|crianca|filho|tranquil|simples|leve|basic)/.test(text)) intent.difficulty = 'facil';
  if (/(medio|normal|equilibr)/.test(text)) intent.difficulty = 'medio';
  if (/(dificil|hard|desafi|insan|impossivel|hardcore|brutal|extrem|pesad|cruel|apelad)/.test(text)) intent.difficulty = 'dificil';

  if (/(curt|rapidinha|pequen|mini )/.test(text)) intent.length = 7;
  if (/(long|grande|maratona|enorme|epica|infinita)/.test(text)) intent.length = 18;
  const nnum = text.match(/(\d{1,2}) (pecas|obstaculos|armadilhas|trechos)/);
  if (nnum) intent.length = Math.max(5, Math.min(20, +nnum[1]));

  if (/(muitos diamantes|cheia de diamantes|cheio de diamantes|chuva de diamantes|tesouro|rica)/.test(text)) intent.gems = 3;
  if (/(sem diamantes|poucos diamantes|nenhum diamante)/.test(text)) intent.gems = 1;

  // pieces: longest tags first so "serra alta" wins over "serra"
  const tagList = [];
  for (const p of PIECES) for (const tag of p.tags) tagList.push({ id: p.id, tag: strip(tag) });
  tagList.sort((a, b) => b.tag.length - a.tag.length);
  const claimed = [];
  const onlySet = new Set();
  for (const { id, tag } of tagList) {
    for (const at of findTag(text, ` ${tag}`)) {
      if (claimed.some(([a, b]) => at >= a && at < b)) continue;
      claimed.push([at, at + tag.length + 1]);
      const before = text.slice(Math.max(0, at - 28), at + 1);
      if (id === 'diamantes' && intent.gems === 1) continue;
      if (NEG.test(before)) intent.exclude.add(id);
      else if (ONLY.test(before)) onlySet.add(id);
      else if (LESS.test(before)) intent.weights[id] = Math.min(intent.weights[id] ?? 1, 0.35);
      else if (MORE.test(before) || (text[at + 1 + tag.length] === 's' && !tag.endsWith('s'))) intent.weights[id] = Math.max(intent.weights[id] ?? 1, 3);
      else intent.weights[id] = Math.max(intent.weights[id] ?? 1, 2);
    }
  }
  // "no abismo" names the theme, not the double-jump piece
  if (intent.theme === 'abismo' && intent.weights.abismo === 2) delete intent.weights.abismo;
  // "serra" also vetoes its variants when negated
  if (intent.exclude.has('serra')) ['serra_alta', 'serra_movel'].forEach((s) => intent.exclude.add(s));
  if (onlySet.size) {
    intent.only = onlySet;
    if (onlySet.has('serra')) ['serra_alta', 'serra_movel'].forEach((s) => onlySet.add(s));
  }
  if (/(sem dash|nao quero dash)/.test(text)) ['parede', 'laser'].forEach((s) => intent.exclude.add(s));
  if (/(so pulo|apenas pulo|so pular)/.test(text)) intent.only = new Set(['buraco', 'abismo', 'degraus', 'espinhos']);
  return intent;
}

/** Hard constraints handed to normalizeSpec(). */
export function constraintsFrom(intent) {
  const want = {};
  for (const [id, m] of Object.entries(intent.weights)) {
    if (m < 2 || intent.exclude.has(id) || (intent.only && !intent.only.has(id))) continue;
    want[id] = m >= 3 ? 3 : 2;
  }
  // "só lasers e paredes": every named piece must actually appear
  if (intent.only) for (const id of intent.only) if (PIECE[id].dif > 0 && !want[id] && intent.only.size <= 4) want[id] = 2;
  return {
    exclude: intent.exclude,
    only: intent.only,
    theme: intent.theme,
    speed: intent.speed,
    difficulty: intent.difficulty,
    length: intent.length,
    gems: intent.gems,
    want,
  };
}

const DEATH_TO_PIECE = {
  'hazard:spikes': 'espinhos',
  'hazard:saw': 'serra',
  'hazard:stalactite': 'estalactite',
  laser: 'laser',
  wall: 'parede',
  fall: 'buraco',
  crash: 'degraus',
};

export function deathPiece(reason) {
  return DEATH_TO_PIECE[reason] || null;
}

/** One-paragraph summary of the last attempt, for the model and the UI. */
export function describeResult(result) {
  if (!result?.spec) return '';
  const s = result.spec;
  const base = `Fase anterior "${s.nome}" (tema ${s.tema}, velocidade ${s.velocidade}, ${s.pecas.length} peças)`;
  if (result.completed) {
    return `${base}: concluída em ${result.attempts} tentativa(s), ${result.gems}/${result.gemsTotal} diamantes.`;
  }
  const dp = deathPiece(result.reason);
  return `${base}: o jogador parou em ${Math.round(result.progress * 100)}% depois de ${result.attempts} tentativa(s)${dp ? `, morreu em ${PIECE[dp].nome.toLowerCase()}` : ''}.`;
}
