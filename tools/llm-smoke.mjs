// End-to-end check of the local GenAI director with the real model, in headless Chromium.
// Usage: node tools/llm-smoke.mjs [baseUrl]   (CI: .github/workflows/llm-smoke.yml)
import { chromium } from 'playwright';
import { appendFileSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:4173/';
const requests = [
  'quero uma fase rosa com muitas serras, nada de laser',
  'próxima fase',
  'fase fácil para criança, verde, muitos diamantes',
  'algo insano no abismo, só lasers e paredes de cristal',
];

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}?llmtest&lowfx`);
await page.waitForFunction(() => window.__llmReady === true, null, { timeout: 60_000 });
const t0 = Date.now();
const out = await page.evaluate((reqs) => window.__llmTest(reqs), requests);
await browser.close();

const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');
let failed = 0;
console.log(`model=${out.model} load=${out.loadMs}ms threads=${out.threads} wall=${Date.now() - t0}ms`);
for (const r of out.runs) {
  const ok = r.engine === 'ia' && !r.fallback;
  if (!ok) failed++;
  const line = `${ok ? 'OK' : 'FALLBACK'} | "${r.request}" | ${r.timings?.totalMs}ms (prompt ${r.timings?.promptMs}ms, ${r.timings?.tokPerSec} tok/s)\nspec: ${JSON.stringify(r.spec)}\nfixes: ${r.fixes.join(' · ') || '-'}\nraw: ${r.raw}`;
  console.log(`\n${line}`);
  console.log(`::${ok ? 'notice' : 'error'} title=LLM ${ok ? 'ok' : 'fallback'}: ${r.request.slice(0, 40)}::${esc(line)}`);
}
console.log(`::notice title=LLM summary::${esc(`load ${out.loadMs}ms · threads ${out.threads} · ${out.runs.length - failed}/${out.runs.length} via IA`)}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```json\n' + JSON.stringify(out, null, 2) + '\n```\n');
process.exit(failed ? 1 : 0);
