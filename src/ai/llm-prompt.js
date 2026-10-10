/** Prompt shared by every local-model backend (wasm and native). */
import { PIECES } from '../ds/components.js';

// Kept short on purpose: on a phone CPU every prompt token costs time.
const SYSTEM = `Crie UMA fase do Diamond Dash (runner 2D: o herói corre sozinho; o jogador só pula, com pulo duplo, e dá dash, que quebra parede e atravessa laser) em JSON.
Peças, na ordem da fase: ${PIECES.map((p) => `${p.id} (${p.ajuda})`).join('; ')}.
Temas: aurora, rosa, gelo, ouro, esmeralda (verde), abismo (vermelho). velocidade 1-5. diamantes 1-3.
Comece fácil e termine difícil, 8 a 14 peças, repita o que o jogador pedir e nunca use o que ele proibir. Fácil = velocidade 1-2; difícil = 4-5.`;

const EXAMPLES = [
  {
    user: 'Pedido: gelo rápido com estalactites, sem serras',
    json: '{"nome":"Vento Polar","tema":"gelo","velocidade":4,"diamantes":2,"pecas":["buraco","espinhos","estalactite","degraus","parede","estalactite","respiro","abismo","estalactite","laser","ruina","estalactite"],"frase":"O teto cai antes de você pensar."}',
  },
];

export function buildMessages(request, context, { examples = EXAMPLES } = {}) {
  const messages = [{ role: 'system', content: SYSTEM }];
  for (const ex of examples) {
    messages.push({ role: 'user', content: ex.user });
    messages.push({ role: 'assistant', content: ex.json });
  }
  if (request !== null) messages.push({ role: 'user', content: `Pedido: ${request || 'próxima fase'}${context ? `\n${context}` : ''}` });
  return messages;
}
