/**
 * Cristal DS → GBNF. The phase schema compiled to a llama.cpp grammar, so the
 * native model can only ever emit a structurally valid phase: known pieces,
 * known themes, bounded numbers and lengths. Compact JSON (no whitespace) to
 * spend as few tokens as possible on a phone CPU.
 */
import { PIECE_IDS } from './components.js';
import { THEME_IDS } from './tokens.js';
import { LIMITS } from './rules.js';

const lit = (s) => JSON.stringify(s); // GBNF string literal == JSON string literal for ASCII
const alt = (xs) => xs.map((x) => lit(JSON.stringify(x))).join(' | ');

export function phaseGrammar() {
  const minP = LIMITS.minPieces;
  const maxP = LIMITS.maxPieces;
  return [
    `root ::= "{" ${lit('"nome":')} nome "," ${lit('"tema":')} tema "," ${lit('"velocidade":')} [1-5] "," ${lit('"diamantes":')} [1-3] "," ${lit('"pecas":')} pecas "," ${lit('"frase":')} frase "}"`,
    `nome ::= "\\"" chr{1,${LIMITS.nameMax}} "\\""`,
    `frase ::= "\\"" chr{1,${LIMITS.phraseMax}} "\\""`,
    `chr ::= [^"\\\\\\x00-\\x1f]`,
    `tema ::= ${alt(THEME_IDS)}`,
    `pecas ::= "[" peca ("," peca){${minP - 1},${maxP - 1}} "]"`,
    `peca ::= ${alt(PIECE_IDS)}`,
  ].join('\n');
}

/** Qwen2.5 ChatML prompt. */
export function chatml(messages) {
  return (
    messages.map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`).join('') + '<|im_start|>assistant\n'
  );
}
