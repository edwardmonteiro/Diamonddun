/** CI hook: run the real local model end-to-end in a browser (see .github/workflows/llm-smoke.yml). */
import { llm, MODEL } from './llm.js';
import { direct } from './director.js';

export function install() {
  window.__llmTest = async (requests) => {
    const out = { model: MODEL.nome, runs: [] };
    const t0 = performance.now();
    await llm.load();
    out.loadMs = Math.round(performance.now() - t0);
    out.threads = llm.state.threads;
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
