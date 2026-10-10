/** Browser backend: llama.cpp compiled to WebAssembly (wllama). Used on the web and in CI. */
import { Wllama, LoggerWithoutDebug } from '@wllama/wllama';
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';
import { SPEC_SCHEMA } from '../../ds/rules.js';

const QS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const GPU_LAYERS = QS.has('gpu') ? +QS.get('gpu') : undefined;

let w = null;
const inst = () => (w ||= new Wllama({ default: wasmUrl }, { logger: LoggerWithoutDebug, allowOffline: true, parallelDownloads: 4 }));
const urlOf = (model) => (QS.get('modelurl') ? new URL(QS.get('modelurl'), location.href).href : model.url);

export const wasmBackend = {
  id: 'web',
  async probe(model) {
    try {
      const cm = inst().cacheManager;
      const name = await cm.getNameFromURL(urlOf(model));
      const size = await cm.getSize(name);
      const meta = size > 0 ? await cm.getMetadata(name) : null;
      return size > 0 && (!meta?.originalSize || meta.originalSize === size) ? 'cached' : 'absent';
    } catch {
      return 'absent';
    }
  },
  async load(model, onProgress) {
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* best effort */
    }
    await inst().loadModelFromUrl(urlOf(model), {
      n_ctx: 2048,
      n_batch: 512,
      ...(GPU_LAYERS !== undefined ? { n_gpu_layers: GPU_LAYERS } : {}),
      useCache: true,
      progressCallback: ({ loaded, total }) => total > 0 && onProgress(loaded / total),
    });
    return { threads: inst().getNumThreads?.() || 1 };
  },
  async warmup(messages) {
    await inst().createChatCompletion({ messages, max_tokens: 1, temperature: 0, cache_prompt: true });
  },
  async generate({ messages, onText, onPrompt, signal }) {
    let raw = '';
    let timings = null;
    await inst().createChatCompletion({
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
          raw += d;
          onText?.(raw);
        }
        if (chunk.timings) timings = chunk.timings;
      },
    });
    return { raw, tokPerSec: timings?.predicted_per_second || null };
  },
  async remove(model) {
    try {
      await w?.exit();
    } catch {
      /* ignore */
    }
    try {
      await inst().cacheManager.delete(urlOf(model));
    } catch {
      /* ignore */
    }
    w = null;
  },
};
