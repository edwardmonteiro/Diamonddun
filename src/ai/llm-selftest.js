/** CI hook: run the real local model end-to-end in a browser (see .github/workflows/llm-smoke.yml). */
import { llm } from './llm.js';
import { direct } from './director.js';

export function install() {
  window.__llmTest = async (requests) => {
    const out = { runs: [] };
    // measure the model, not the software-rendered game loop competing for CPU
    window.__game?.loop?.sleep?.();
    const t0 = performance.now();
    await llm.load();
    out.loadMs = Math.round(performance.now() - t0);
    const tw = performance.now();
    await llm._warm;
    out.warmMs = Math.round(performance.now() - tw);
    out.threads = llm.state.threads;
    out.model = llm.model.nome;
    out.backend = llm.state.backend;
    let prev = null;
    for (const request of requests) {
      const res = await direct({ request, prev, engine: 'ia' });
      out.runs.push({ request, engine: res.engine, fallback: res.fallback, raw: res.raw, spec: res.spec, fixes: res.fixes, timings: res.timings });
      prev = { spec: res.spec, completed: true, attempts: 1, gems: 30, gemsTotal: 40 };
    }
    return out;
  };
  window.__llmReady = true;
}
