/**
 * Local GenAI director — llama.cpp compiled to WebAssembly (wllama) running a
 * small instruct model entirely on the phone. Output is constrained by the
 * design-system JSON schema (grammar-guided decoding), then passed through the
 * same guardrails as every other spec.
 */
import { Wllama, LoggerWithoutDebug } from '@wllama/wllama';
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';
import { PIECES } from '../ds/components.js';
import { SPEC_SCHEMA } from '../ds/rules.js';

export const MODELS = [
  {
    id: 'qwen2.5-0.5b',
    nome: 'Qwen2.5 0.5B Instruct',
    licenca: 'Apache-2.0',
    url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    mb: 491,
  },
];
export const MODEL = MODELS[0];

const SYSTEM = `Você é o designer de fases do jogo Diamond Dash, um runner 2D. O herói corre sozinho para a direita; o jogador só PULA (com pulo duplo no ar) e dá DASH (atravessa parede de cristal e laser).
Crie UMA fase em JSON a partir do pedido do jogador.
Peças (use só estes ids em "pecas", na ordem em que aparecem na fase):
${PIECES.map((p) => `- ${p.id}: ${p.ajuda}`).join('\n')}
Temas: aurora (azul), rosa, gelo (branco), ouro (dourado), esmeralda (verde), abismo (vermelho escuro).
velocidade: 1 lenta até 5 muito rápida. diamantes: 1 poucos, 2 normal, 3 muitos.
Regras: comece fácil e cresça até um clímax no fim; use de 8 a 14 peças (mínimo 5, máximo 20); repita as peças que o jogador pedir; nunca use peças que ele proibir; se ele pedir a próxima fase, use o resultado anterior: venceu fácil = mais desafio, morreu muito = alivie a peça que matou.
nome: título curto e evocativo em português. frase: dica ou provocação curta.`;

const EXAMPLES = [
  {
    user: 'Pedido do jogador: quero uma fase rosa com muitas serras, nada de laser',
    json: '{"nome":"Noite das Serras","tema":"rosa","velocidade":3,"diamantes":2,"pecas":["buraco","serra","espinhos","serra_alta","respiro","serra","degraus","serra_movel","diamantes","serra","abismo","serra_movel"],"frase":"Leia o giro das lâminas antes de saltar."}',
  },
  {
    user: 'Pedido do jogador: próxima fase\nFase anterior "Ponte de Gelo" (tema gelo, velocidade 2, 9 peças): concluída em 1 tentativa(s), 40/44 diamantes.',
    json: '{"nome":"Cânion Dourado","tema":"ouro","velocidade":3,"diamantes":2,"pecas":["buraco","espinhos","degraus","parede","respiro","estalactite","buraco","ruina","laser","espinhos","abismo"],"frase":"Você venceu o gelo. Agora o sol aperta."}',
  },
];

let wllama = null;
let state = { status: 'unknown', progress: 0, error: null, threads: 0 };
const listeners = new Set();

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

export const llm = {
  get state() {
    return state;
  },
  subscribe(fn) {
    listeners.add(fn);
    fn(state);
    return () => listeners.delete(fn);
  },

  instance() {
    if (!wllama) {
      wllama = new Wllama({ default: wasmUrl }, { logger: LoggerWithoutDebug, allowOffline: true, parallelDownloads: 4 });
    }
    return wllama;
  },

  /** Is the model already on the device? Sets status to 'cached' | 'absent'. */
  async probe() {
    if (state.status === 'ready' || state.status === 'loading' || state.status === 'downloading') return state.status;
    try {
      const cm = this.instance().cacheManager;
      const name = await cm.getNameFromURL(MODEL.url);
      const size = await cm.getSize(name);
      const meta = size > 0 ? await cm.getMetadata(name) : null;
      const ok = size > 0 && (!meta?.originalSize || meta.originalSize === size);
      set({ status: ok ? 'cached' : 'absent' });
    } catch (e) {
      set({ status: 'absent' });
    }
    return state.status;
  },

  /** Download (if needed) and load the model into memory. */
  async load() {
    if (state.status === 'ready') return;
    if (this._loading) return this._loading;
    this._loading = (async () => {
      const w = this.instance();
      const cached = (await this.probe()) === 'cached';
      set({ status: cached ? 'loading' : 'downloading', progress: 0, error: null });
      try {
        await navigator.storage?.persist?.();
      } catch {
        /* best effort */
      }
      try {
        await w.loadModelFromUrl(MODEL.url, {
          n_ctx: 2048,
          n_batch: 256,
          useCache: true,
          progressCallback: ({ loaded, total }) => {
            if (total > 0) set({ status: 'downloading', progress: loaded / total });
            if (total > 0 && loaded >= total) set({ status: 'loading', progress: 1 });
          },
        });
        set({ status: 'ready', progress: 1, threads: w.getNumThreads?.() || 1, multi: w.isMultithread?.() || false });
      } catch (e) {
        const msg = String(e?.message || e);
        const friendly = /fetch|network|tunnel|offline/i.test(msg) ? 'Sem conexão para baixar o modelo.' : /memory|oom|alloc/i.test(msg) ? 'Memória insuficiente no aparelho.' : msg;
        set({ status: 'error', error: friendly });
        throw e;
      } finally {
        this._loading = null;
      }
    })();
    return this._loading;
  },

  async remove() {
    try {
      await wllama?.exit();
    } catch {
      /* ignore */
    }
    try {
      await this.instance().cacheManager.delete(MODEL.url);
    } catch {
      /* ignore */
    }
    wllama = null;
    set({ status: 'absent', progress: 0 });
  },

  /**
   * Ask the model for a phase. Streams raw JSON text through onText.
   * Returns { raw, json, timings }.
   */
  async generate(request, context, { onText, onPrompt, signal } = {}) {
    if (state.status !== 'ready') await this.load();
    const w = this.instance();
    const messages = [{ role: 'system', content: SYSTEM }];
    for (const ex of EXAMPLES) {
      messages.push({ role: 'user', content: ex.user });
      messages.push({ role: 'assistant', content: ex.json });
    }
    messages.push({ role: 'user', content: `Pedido do jogador: ${request || 'próxima fase'}${context ? `\n${context}` : ''}` });

    let raw = '';
    let timings = null;
    const t0 = performance.now();
    let firstTokenAt = 0;
    set({ status: 'thinking' });
    try {
      await w.createChatCompletion({
        messages,
        max_tokens: 380,
        temperature: 0.8,
        top_p: 0.92,
        top_k: 40,
        cache_prompt: true,
        return_progress: true,
        abortSignal: signal,
        response_format: { type: 'json_schema', json_schema: { name: 'fase', schema: SPEC_SCHEMA, strict: true } },
        stream: true,
        onData: (chunk) => {
          if (chunk.prompt_progress && onPrompt) {
            const p = chunk.prompt_progress;
            onPrompt(p.total ? (p.processed + p.cache) / p.total : 0);
          }
          const d = chunk.choices?.[0]?.delta?.content;
          if (d) {
            if (!firstTokenAt) firstTokenAt = performance.now();
            raw += d;
            onText?.(raw);
          }
          if (chunk.timings) timings = chunk.timings;
        },
      });
    } finally {
      set({ status: 'ready' });
    }
    const t1 = performance.now();
    return {
      raw,
      json: parseLoose(raw),
      timings: {
        totalMs: Math.round(t1 - t0),
        promptMs: Math.round((firstTokenAt || t1) - t0),
        tokPerSec: timings?.predicted_per_second ? +timings.predicted_per_second.toFixed(1) : null,
        threads: state.threads,
      },
    };
  },
};

/** Parse model text, tolerating truncation (close open brackets). */
export function parseLoose(text) {
  const s = String(text || '').trim();
  const start = s.indexOf('{');
  if (start < 0) return null;
  let body = s.slice(start);
  try {
    return JSON.parse(body);
  } catch {
    /* try to repair */
  }
  body = body.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, '');
  let fixed = body;
  const quotes = (fixed.match(/(?<!\\)"/g) || []).length;
  if (quotes % 2) fixed += '"';
  const opens = (fixed.match(/\[/g) || []).length - (fixed.match(/\]/g) || []).length;
  for (let i = 0; i < opens; i++) fixed += ']';
  const braces = (fixed.match(/{/g) || []).length - (fixed.match(/}/g) || []).length;
  for (let i = 0; i < braces; i++) fixed += '}';
  try {
    return JSON.parse(fixed);
  } catch {
    return null;
  }
}

/** Pieces already complete in a partial stream (for the live blueprint). */
export function partialPieces(text) {
  const m = String(text).match(/"pecas"\s*:\s*\[([^\]]*)/);
  if (!m) return [];
  return [...m[1].matchAll(/"([a-z_]+)"\s*(?=,|$)/g)].map((x) => x[1]);
}

export function partialField(text, key) {
  const m = String(text).match(new RegExp(`"${key}"\\s*:\\s*("([^"]*)"?|\\d)`));
  if (!m) return null;
  return m[2] ?? m[1];
}
