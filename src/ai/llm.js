/**
 * Local GenAI director. One facade, two engines:
 *   - nativo: llama.cpp compiled for ARM inside the APK (fast, multi-threaded)
 *   - web:    llama.cpp in WebAssembly (browser/CI fallback)
 * Output is grammar-constrained to the Cristal DS phase schema, then passes
 * through the same guardrails as every other spec.
 */
import { buildMessages } from './llm-prompt.js';
import { save } from '../storage.js';

export const MODELS = [
  {
    id: 'qwen2.5-1.5b',
    nome: 'Qwen2.5 1.5B',
    rotulo: 'Melhor',
    licenca: 'Apache-2.0',
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    bytes: 1117320736,
    mb: 1066,
    native: true,
  },
  {
    id: 'qwen2.5-0.5b',
    nome: 'Qwen2.5 0.5B',
    rotulo: 'Leve',
    licenca: 'Apache-2.0',
    url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    bytes: 491400032,
    mb: 469,
    native: true,
    web: true,
  },
];

let backend = null; // resolved lazily
let state = { status: 'unknown', progress: 0, error: null, threads: 0, backend: null, model: null };
const listeners = new Set();
function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

async function pickBackend() {
  if (backend) return backend;
  const { nativeAvailable, nativeBackend } = await import('./backends/native.js');
  if (await nativeAvailable()) backend = nativeBackend;
  else backend = (await import('./backends/wasm.js')).wasmBackend;
  return backend;
}

function friendly(e) {
  const msg = String(e?.message || e);
  if (/fetch|network|tunnel|offline|unknownhost|unable to resolve|timeout|http 5/i.test(msg)) return 'Sem conexão para baixar o modelo.';
  if (/memory|oom|alloc|contexto/i.test(msg)) return 'Memória insuficiente no aparelho.';
  return msg.slice(0, 120);
}

export const llm = {
  get state() {
    return state;
  },
  get model() {
    return state.model || MODELS[0];
  },
  subscribe(fn) {
    listeners.add(fn);
    fn(state);
    return () => listeners.delete(fn);
  },

  /** Models this device can run, with the current choice. */
  async models() {
    const b = await pickBackend();
    const list = MODELS.filter((m) => (b.id === 'nativo' ? m.native : m.web));
    const saved = list.find((m) => m.id === save.get('llmModel'));
    return { list, current: saved || list[0], backend: b.id };
  },

  async setModel(id) {
    if (state.status === 'downloading' || state.status === 'loading' || state.status === 'thinking') return;
    save.set('llmModel', id);
    this._warmed = false;
    set({ status: 'unknown', model: null, progress: 0, error: null });
    await this.probe(true);
  },

  /** Sets status to 'ready' | 'cached' | 'absent'. */
  async probe(force = false) {
    if (!force && ['ready', 'loading', 'downloading', 'thinking'].includes(state.status)) return state.status;
    const b = await pickBackend();
    const { current } = await this.models();
    try {
      const s = await b.probe(current);
      set({ status: s === 'ready' ? 'ready' : s, backend: b.id, model: current });
    } catch {
      set({ status: 'absent', backend: b.id, model: current });
    }
    return state.status;
  },

  /** Download (if needed) and load the model into memory. */
  async load() {
    if (state.status === 'ready') return;
    if (this._loading) return this._loading;
    this._loading = (async () => {
      const b = await pickBackend();
      const cached = (await this.probe(true)) === 'cached';
      const model = state.model;
      set({ status: cached ? 'loading' : 'downloading', progress: 0, error: null });
      try {
        const r = await b.load(
          model,
          (p) => set({ status: p >= 1 ? 'loading' : 'downloading', progress: p }),
          (phase) => set({ status: phase }),
        );
        set({ status: 'ready', progress: 1, threads: r.threads || 1 });
        this.warmup();
      } catch (e) {
        set({ status: 'error', error: friendly(e) });
        throw e;
      } finally {
        this._loading = null;
      }
    })();
    return this._loading;
  },

  /**
   * Pre-fill the KV cache with the fixed prefix (rules + example) while the
   * player is still typing, so "Gerar" only pays for their own words.
   */
  warmup() {
    if (state.status !== 'ready' || this._warmed || this._warm) return this._warm;
    const t0 = performance.now();
    this._warm = backend
      .warmup(buildMessages('próxima fase', ''))
      .then(() => {
        this._warmed = true;
        this.warmMs = Math.round(performance.now() - t0);
      })
      .catch(() => {})
      .finally(() => {
        this._warm = null;
      });
    return this._warm;
  },

  async remove() {
    const b = await pickBackend();
    try {
      await b.remove(this.model);
    } catch {
      /* ignore */
    }
    this._warmed = false;
    set({ status: 'absent', progress: 0 });
  },

  /**
   * Ask the model for a phase. Streams raw JSON text through onText.
   * Returns { raw, json, timings }.
   */
  async generate(request, context, { onText, onPrompt, signal } = {}) {
    if (state.status !== 'ready') await this.load();
    await this._warm?.catch(() => {});
    const t0 = performance.now();
    let firstTokenAt = 0;
    set({ status: 'thinking' });
    let res;
    try {
      res = await backend.generate({
        messages: buildMessages(request, context),
        signal,
        onPrompt,
        onText: (raw) => {
          if (!firstTokenAt) firstTokenAt = performance.now();
          onText?.(raw);
        },
      });
    } finally {
      set({ status: 'ready' });
    }
    const t1 = performance.now();
    return {
      raw: res.raw,
      json: parseLoose(res.raw),
      timings: {
        totalMs: Math.round(t1 - t0),
        promptMs: Math.round((firstTokenAt || t1) - t0),
        tokPerSec: res.tokPerSec,
        threads: state.threads,
        backend: backend.id,
        model: state.model?.id,
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
