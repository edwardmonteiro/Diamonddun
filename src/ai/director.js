/**
 * Director facade: request (+ last result) → validated phase spec.
 *
 *   engine 'ia'     → local LLM, schema-constrained, then guardrails
 *   engine 'rapido' → deterministic quick director, then guardrails
 * Any LLM failure falls back to the quick director, and says so.
 */
import { parseIntent, constraintsFrom, describeResult } from './intent.js';
import { quickSpec } from './quick-director.js';
import { normalizeSpec } from '../ds/rules.js';
import { llm } from './llm.js';

export async function direct({ request = '', prev = null, engine = 'rapido', onText, onPrompt, signal } = {}) {
  const intent = parseIntent(request);
  const constraints = constraintsFrom(intent);
  let raw = null;
  let json = null;
  let timings = null;
  let fallback = null;

  if (engine === 'ia') {
    try {
      const res = await llm.generate(request.trim(), describeResult(prev), { onText, onPrompt, signal });
      raw = res.raw;
      json = res.json;
      timings = res.timings;
      if (!json) fallback = 'a IA devolveu um texto ilegível';
    } catch (e) {
      if (signal?.aborted) throw e;
      fallback = `a IA local falhou (${String(e?.message || e).slice(0, 60)})`;
    }
  }
  if (!json) json = quickSpec(intent, prev);

  const { spec, fixes, stats } = normalizeSpec(json, constraints);
  return {
    spec,
    fixes,
    stats,
    engine: fallback || engine === 'rapido' ? 'rapido' : 'ia',
    fallback,
    raw,
    timings,
  };
}
