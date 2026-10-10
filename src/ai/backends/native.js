/**
 * Android backend: llama.cpp compiled natively (ARM NEON / dot-product kernels,
 * multi-threaded) behind the LocalLlm Capacitor plugin. ~10–20× faster than wasm.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { phaseGrammar, chatml } from '../../ds/grammar.js';

const LocalLlm = registerPlugin('LocalLlm');
const fileOf = (model) => model.url.split('/').pop();

export async function nativeAvailable() {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const info = await LocalLlm.info({ file: '' });
    return !!info.native;
  } catch {
    return false;
  }
}

let loadedFile = null;

export const nativeBackend = {
  id: 'nativo',
  async probe(model) {
    const info = await LocalLlm.info({ file: fileOf(model) });
    if (info.loaded && loadedFile === fileOf(model)) return 'ready';
    return info.downloaded ? 'cached' : 'absent';
  },
  async load(model, onProgress, onPhase) {
    const file = fileOf(model);
    const info = await LocalLlm.info({ file });
    if (!info.downloaded) {
      const sub = await LocalLlm.addListener('progress', (p) => p.total > 0 && onProgress(p.loaded / p.total));
      try {
        await LocalLlm.download({ url: model.url, file, bytes: model.bytes || 0 });
      } finally {
        sub.remove();
      }
    }
    if (loadedFile && loadedFile !== file) await LocalLlm.remove({ file: '__none__' }); // frees the other model
    onPhase?.('loading');
    const r = await LocalLlm.load({ file, ctx: 2048 });
    loadedFile = file;
    return { threads: r.threads, system: r.system };
  },
  async warmup(messages) {
    await LocalLlm.prefill({ prompt: chatml(messages) });
  },
  async generate({ messages, onText, signal }) {
    let raw = '';
    const sub = await LocalLlm.addListener('token', (t) => {
      raw += t.text;
      onText?.(raw);
    });
    const onAbort = () => LocalLlm.cancel();
    signal?.addEventListener('abort', onAbort);
    try {
      const r = await LocalLlm.generate({ prompt: chatml(messages), grammar: phaseGrammar(), maxTokens: 384, temperature: 0.8 });
      if (signal?.aborted) throw new DOMException('cancelado', 'AbortError');
      return { raw: r.text || raw, tokPerSec: r.genMs > 0 ? +((r.genTokens * 1000) / r.genMs).toFixed(1) : null, stats: r };
    } finally {
      sub.remove();
      signal?.removeEventListener('abort', onAbort);
    }
  },
  async remove(model) {
    await LocalLlm.remove({ file: fileOf(model) });
    loadedFile = null;
  },
};
