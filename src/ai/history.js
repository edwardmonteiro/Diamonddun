/** Small on-device library of generated phases (most recent first). */
import { save } from '../storage.js';

const MAX = 12;
const key = (spec) => JSON.stringify([spec.nome, spec.tema, spec.velocidade, spec.pecas]);

export function listPhases() {
  return save.get('phases') || [];
}

export function addPhase(spec, meta = {}) {
  const list = listPhases().filter((p) => key(p.spec) !== key(spec));
  list.unshift({ spec, engine: meta.engine || 'rapido', pedido: meta.pedido || '', at: Date.now(), done: false, tries: 0 });
  save.set('phases', list.slice(0, MAX));
}

export function recordPhaseResult(result) {
  if (!result?.spec) return;
  const list = listPhases();
  const it = list.find((p) => key(p.spec) === key(result.spec));
  if (!it) return;
  it.tries = (it.tries || 0) + 1;
  if (result.completed) it.done = true;
  save.set('phases', list);
}
