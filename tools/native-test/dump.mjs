// Writes the exact grammar + prompts the app sends to the native engine.
import { writeFileSync, mkdirSync } from 'node:fs';
import { phaseGrammar, chatml } from '../../src/ds/grammar.js';
import { buildMessages } from '../../src/ai/llm-prompt.js';
const out = process.argv[2];
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/grammar.gbnf`, phaseGrammar());
const reqs = process.argv.slice(3);
const opts = process.env.NOEX ? { examples: [] } : {};
reqs.forEach((r, i) => writeFileSync(`${out}/p${i}.txt`, chatml(buildMessages(r, '', opts))));
console.log(phaseGrammar());
