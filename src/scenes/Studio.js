import Phaser from 'phaser';
import '../studio/studio.css';
import { setupCamera } from '../config.js';
import { Parallax } from '../background.js';
import { fadeMusic } from '../ui.js';
import { save } from '../storage.js';
import { applyCssTokens, theme, THEMES } from '../ds/tokens.js';
import { PIECES, PIECE, glyphSvg } from '../ds/components.js';
import { specStats } from '../ds/rules.js';
import { direct } from '../ai/director.js';
import { describeResult, deathPiece } from '../ai/intent.js';
import { llm, MODEL, partialPieces, partialField } from '../ai/llm.js';
import { addPhase, listPhases } from '../ai/history.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const SUGGEST = ['Mais difícil', 'Mais fácil', 'Muitos diamantes', 'Só pulos', 'Lasers e paredes', 'Muitas serras', 'Rápida', 'Curta', 'Sem estalactites', 'Tema gelo', 'Noite rosa', 'Abismo vermelho'];

/**
 * Estúdio de fases — the player describes a phase, a director (local LLM or
 * quick) drafts it, Cristal DS guardrails make it fair, and the blueprint is
 * shown as design-system tokens before playing.
 */
export default class Studio extends Phaser.Scene {
  constructor() {
    super('Studio');
  }

  init(data) {
    this.result = data?.result || this.registry.get('lastResult') || null;
    this.next = !!data?.next;
    this.current = this.result?.spec && !this.next
      ? { spec: this.result.spec, stats: specStats(this.result.spec), fixes: [], engine: 'replay', ms: 0 }
      : null;
  }

  create() {
    this.leaving = false;
    this.busy = false;
    this.liveBox = null;
    this.liveTheme = null;
    this.drawer = null;
    setupCamera(this).fadeIn(300, 5, 6, 26);
    this.bg = new Parallax(this, this.result?.spec?.tema || 'aurora');
    this.scroll = 0;
    fadeMusic(this, 'menu', 0.45);
    applyCssTokens(this.result?.spec?.tema || 'aurora');
    this.engine = save.get('engine') || 'ia';
    this.buildDom();
    this.unsub = llm.subscribe((st) => this.renderEngine(st));
    llm.probe().then((s) => {
      if (this.engine === 'ia' && s === 'cached') llm.load().catch(() => {});
    });
    this.events.once('shutdown', () => this.teardown());
    if (this.next && this.result?.completed) this.generate();
  }

  teardown() {
    this.abort?.abort();
    this.unsub?.();
    this.root?.remove();
    this.drawer?.remove();
  }

  update(_, dt) {
    this.scroll += dt * 0.5;
    this.bg.update(this.scroll);
  }

  // ------------------------------------------------------------------ DOM
  buildDom() {
    const r = this.result;
    const root = document.createElement('div');
    root.id = 'studio';
    root.innerHTML = `
      <header class="st-head">
        <button class="ds-btn ds-btn--icon" data-act="back" aria-label="Voltar">${icon('back')}</button>
        <div>
          <div class="st-title">ESTÚDIO DE FASES</div>
          <div class="st-sub">Descreva. A IA desenha. O design system garante que dá pra jogar.</div>
        </div>
        <div class="st-grow"></div>
        <div class="ds-seg" role="tablist">
          <button data-engine="ia">IA LOCAL</button>
          <button data-engine="rapido">RÁPIDO</button>
        </div>
        <button class="ds-btn ds-btn--icon" data-act="history" aria-label="Minhas fases">${icon('list')}</button>
      </header>

      <section class="st-left">
        ${r?.spec ? `<div class="st-context ds-surface">${contextLine(r)}</div>` : ''}
        <textarea class="st-input" rows="3" maxlength="240" enterkeyhint="send"
          placeholder="${esc(r?.spec ? 'Como deve ser a próxima? ex.: mais rápida, tema gelo, sem laser' : 'Descreva a fase… ex.: noite rosa, muitas serras, nada de laser')}"></textarea>
        <div class="st-chips">${this.suggestions().map((s) => `<button class="ds-chip" data-chip="${esc(s)}">${esc(s)}</button>`).join('')}</div>
        <div class="st-actions">
          <button class="ds-btn ds-btn--primary" data-act="gen">${icon('spark')} GERAR FASE</button>
          <button class="ds-btn ds-btn--ghost ds-btn--sm" data-act="cancel" hidden>CANCELAR</button>
        </div>
        <div class="st-engine ds-surface"></div>
      </section>

      <section class="st-right ds-surface"></section>`;
    document.body.appendChild(root);
    this.root = root;
    this.$ = (q) => root.querySelector(q);
    this.input = this.$('.st-input');
    if (this.next && this.result?.completed) this.input.value = '';

    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.sound.play('tap', { volume: 0.5 });
      if (b.dataset.chip) return this.addChip(b);
      if (b.dataset.engine) return this.setEngine(b.dataset.engine);
      const act = b.dataset.act;
      if (act === 'back') return this.leave('Title');
      if (act === 'gen') return this.generate();
      if (act === 'cancel') return this.abort?.abort();
      if (act === 'play') return this.play();
      if (act === 'vary') return this.generate(true);
      if (act === 'history') return this.openHistory();
      if (act === 'download') return llm.load().catch(() => {});
      if (act === 'remove') return llm.remove();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.input.blur();
        this.generate();
      }
    });
    this.setEngine(this.engine, true);
    this.renderBlueprint();
  }

  suggestions() {
    const r = this.result;
    const list = [...SUGGEST];
    if (r?.spec && !r.completed) {
      const dp = deathPiece(r.reason);
      if (dp) list.unshift(`Menos ${PIECE[dp].nome.toLowerCase()}`);
      list.unshift('Mais fácil');
    } else if (r?.completed) list.unshift('Próxima fase');
    return [...new Set(list)].slice(0, 9);
  }

  addChip(b) {
    const v = this.input.value.trim();
    const add = b.dataset.chip.toLowerCase();
    this.input.value = v ? `${v}, ${add}` : add;
    b.classList.add('on');
  }

  setEngine(id, silent) {
    this.engine = id;
    save.set('engine', id);
    this.root.querySelectorAll('[data-engine]').forEach((b) => b.classList.toggle('on', b.dataset.engine === id));
    this.renderEngine(llm.state);
    if (!silent && id === 'ia' && llm.state.status === 'cached') llm.load().catch(() => {});
  }

  renderEngine(st) {
    const box = this.$?.('.st-engine');
    if (!box) return;
    if (this.engine === 'rapido') {
      box.innerHTML = `<div><strong>Gerador rápido</strong> · instantâneo, offline, sem modelo. Entende tema, velocidade, peças pedidas e vetos.</div>`;
      return;
    }
    const pct = Math.round((st.progress || 0) * 100);
    const map = {
      unknown: `<div>Verificando IA local…</div>`,
      absent: `<div><strong>IA local · ${MODEL.nome}</strong><br>${MODEL.mb} MB, baixa uma vez e roda offline no aparelho. Sem o modelo, uso o gerador rápido.</div>
        <div><button class="ds-btn ds-btn--ghost ds-btn--sm" data-act="download">${icon('down')} BAIXAR MODELO</button></div>`,
      cached: `<div><strong>IA local</strong> · modelo no aparelho, carregando…</div><div class="st-bar"><i style="width:30%"></i></div>`,
      downloading: `<div><strong>Baixando ${MODEL.nome}</strong> · ${pct}% de ${MODEL.mb} MB</div><div class="st-bar"><i style="width:${pct}%"></i></div>`,
      loading: `<div><strong>Carregando modelo na memória…</strong></div><div class="st-bar"><i style="width:90%"></i></div>`,
      ready: `<div><strong>IA local pronta</strong> · ${MODEL.nome} · CPU ${st.threads || 1} thread${(st.threads || 1) > 1 ? 's' : ''} · offline</div>
        <div><button class="ds-btn ds-btn--ghost ds-btn--sm" data-act="remove">APAGAR MODELO</button></div>`,
      thinking: `<div><strong>IA local pensando…</strong> · ${MODEL.nome}</div>`,
      error: `<div><strong>A IA local não carregou.</strong> ${esc((st.error || '').slice(0, 90))}<br>Uso o gerador rápido enquanto isso.</div>
        <div><button class="ds-btn ds-btn--ghost ds-btn--sm" data-act="download">TENTAR DE NOVO</button></div>`,
    };
    box.innerHTML = map[st.status] || map.unknown;
  }

  // ------------------------------------------------------------ generate
  async generate(vary = false) {
    if (this.busy) return;
    this.busy = true;
    const request = this.input.value.trim() || (this.result?.spec ? 'próxima fase' : '');
    let engine = this.engine;
    let note = null;
    if (engine === 'ia' && !['ready', 'cached', 'loading', 'downloading', 'thinking'].includes(llm.state.status)) {
      engine = 'rapido';
      note = 'Modelo não baixado: gerei no modo rápido.';
    }
    this.abort = new AbortController();
    this.$('[data-act="gen"]').disabled = true;
    this.$('[data-act="cancel"]').hidden = engine !== 'ia';
    this.renderLive({ phase: engine === 'ia' ? 'Lendo seu pedido…' : 'Desenhando…', text: '' });
    try {
      const t0 = performance.now();
      const res = await direct({
        request: vary && request ? `${request} (outra variação)` : request,
        prev: this.result,
        engine,
        signal: this.abort.signal,
        onPrompt: (p) => this.renderLive({ phase: `Lendo seu pedido… ${Math.round(p * 100)}%`, text: '' }),
        onText: (text) => this.renderLive({ phase: 'Desenhando a fase…', text }),
      });
      if (engine === 'rapido') await new Promise((r) => setTimeout(r, 380)); // let the strip animate
      res.ms = Math.round(performance.now() - t0);
      if (note && !res.fallback) res.fallback = note;
      this.current = res;
      addPhase(res.spec, { engine: res.engine, pedido: request });
      this.renderBlueprint();
    } catch (e) {
      if (!this.abort.signal.aborted) console.error(e);
      this.renderBlueprint();
    } finally {
      this.busy = false;
      if (this.root?.isConnected) {
        this.$('[data-act="gen"]').disabled = false;
        this.$('[data-act="cancel"]').hidden = true;
      }
    }
  }

  renderLive({ phase, text }) {
    const box = this.$('.st-right');
    if (!box) return;
    const pieces = text ? partialPieces(text) : [];
    const nome = text ? partialField(text, 'nome') : null;
    const tema = text ? partialField(text, 'tema') : null;
    if (tema && THEMES[tema] && tema !== this.liveTheme) {
      this.liveTheme = tema;
      applyCssTokens(tema);
      this.bg.setTheme(tema);
    }
    if (!this.liveBox || !box.contains(this.liveBox)) {
      box.innerHTML = `
        <div class="st-kicker"><i class="st-dot live"></i><span class="ds-label" data-k></span></div>
        <div class="st-name" data-n></div>
        <div class="st-strip" data-s></div>
        <div class="st-raw" data-r></div>`;
      this.liveBox = box.firstElementChild;
      this.liveCount = 0;
    }
    box.querySelector('[data-k]').textContent = phase;
    box.querySelector('[data-n]').textContent = nome || '';
    const strip = box.querySelector('[data-s]');
    for (let i = this.liveCount; i < pieces.length; i++) strip.insertAdjacentHTML('beforeend', pieceHtml(pieces[i]));
    if (pieces.length > this.liveCount) strip.scrollLeft = strip.scrollWidth;
    this.liveCount = pieces.length;
    box.querySelector('[data-r]').textContent = text ? text.slice(-140) : '';
  }

  renderBlueprint() {
    this.liveBox = null;
    const box = this.$('.st-right');
    const res = this.current;
    if (!res) {
      box.innerHTML = `
        <div class="st-kicker"><i class="st-dot"></i><span class="ds-label">Cristal DS · peças da fase</span></div>
        <div class="st-empty">Toda fase é uma sequência destas peças. A IA escolhe a ordem, o tema, a velocidade e os diamantes; o design system cuida de distâncias, ritmo e justiça.</div>
        <div class="st-catalog">${PIECES.map((p) => pieceHtml(p.id)).join('')}</div>`;
      return;
    }
    const { spec, stats, fixes } = res;
    const th = theme(spec.tema);
    applyCssTokens(spec.tema);
    this.bg.setTheme(spec.tema);
    const st = stats || specStats(spec);
    const who = res.engine === 'replay' ? 'Última fase jogada' : res.engine === 'ia' ? `IA local · ${(res.ms / 1000).toFixed(1)} s` : 'Gerador rápido';
    const speed = '●'.repeat(spec.velocidade) + '○'.repeat(5 - spec.velocidade);
    const diff = '●'.repeat(st.dificuldade) + '○'.repeat(5 - st.dificuldade);
    const notes = [res.fallback, ...(fixes || [])].filter(Boolean);
    box.innerHTML = `
      <div class="st-kicker"><i class="st-dot"></i><span class="ds-label">Fase gerada · ${esc(who)}</span></div>
      <div class="st-name">${esc(spec.nome)}</div>
      <div class="st-phrase">${esc(spec.frase)}</div>
      <div class="st-meta">
        <span><i class="st-swatch" style="background:${th.accent}"></i>${esc(th.nome)}</span>
        <span>Velocidade <b class="st-pips">${speed}</b></span>
        <span>Dificuldade <b class="st-pips">${diff}</b></span>
        <span>${spec.pecas.length} peças · ~${st.segundos} s</span>
      </div>
      <div class="st-strip">${spec.pecas.map((id, i) => (i ? '<span class="st-arrow">›</span>' : '') + pieceHtml(id)).join('')}<span class="st-arrow">›</span><span class="ds-piece st-flag" data-dif="0">${icon('flag')}CHEGADA</span></div>
      ${notes.length ? `<div class="st-fixes"><b>Ajustes do design system:</b> ${notes.map(esc).join(' · ')}</div>` : ''}
      <div class="st-play">
        <button class="ds-btn ds-btn--primary" data-act="play">${icon('play')} JOGAR</button>
        <button class="ds-btn ds-btn--ghost" data-act="vary">VARIAR</button>
      </div>`;
  }

  openHistory() {
    const list = listPhases();
    const d = document.createElement('div');
    d.className = 'st-drawer';
    d.innerHTML = `<div class="ds-surface">
      <div class="st-head" style="min-height:auto"><div class="st-title">MINHAS FASES</div><div class="st-grow"></div>
      <button class="ds-btn ds-btn--icon" data-x aria-label="Fechar">${icon('x')}</button></div>
      ${list.length ? list.map((p, i) => `<button class="st-hrow" data-i="${i}">
          <i class="st-swatch" style="background:${theme(p.spec.tema).accent}"></i>
          <span>${esc(p.spec.nome)}<small>${p.spec.pecas.length} peças · vel. ${p.spec.velocidade} · ${p.engine === 'ia' ? 'IA local' : 'rápido'}${p.pedido ? ` · “${esc(p.pedido.slice(0, 40))}”` : ''}</small></span>
          <span class="ds-label">${p.done ? '✓ feita' : p.tries ? `${p.tries}×` : 'nova'}</span></button>`).join('')
        : '<div class="st-empty">Nenhuma fase ainda. Gere a primeira!</div>'}
    </div>`;
    d.addEventListener('click', (e) => {
      const row = e.target.closest('[data-i]');
      if (row) {
        const p = list[+row.dataset.i];
        this.current = { spec: p.spec, stats: specStats(p.spec), fixes: [], engine: p.engine, ms: 0 };
        this.renderBlueprint();
      }
      if (row || e.target === d || e.target.closest('[data-x]')) {
        d.remove();
        this.drawer = null;
      }
    });
    document.body.appendChild(d);
    this.drawer = d;
  }

  play() {
    if (!this.current) return;
    this.leave('Game', { spec: this.current.spec, attempt: 1 });
  }

  leave(scene, data) {
    if (this.leaving) return;
    this.leaving = true;
    this.root.style.transition = 'opacity 220ms';
    this.root.style.opacity = '0';
    this.cameras.main.fadeOut(280, 5, 6, 26);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(scene, data));
  }
}

function contextLine(r) {
  const s = r.spec;
  if (r.completed) return `<b>${esc(s.nome)}</b> concluída em ${r.attempts} tentativa${r.attempts > 1 ? 's' : ''} · ${r.gems}/${r.gemsTotal} diamantes. A IA vai usar isso para desenhar a próxima.`;
  const dp = deathPiece(r.reason);
  return `<b>${esc(s.nome)}</b>: você chegou a ${Math.round(r.progress * 100)}%${dp ? `, derrubado por <b>${esc(PIECE[dp].nome.toLowerCase())}</b>` : ''}. Peça um ajuste ou volte e tente de novo.`;
}

function pieceHtml(id) {
  const p = PIECE[id];
  if (!p) return '';
  return `<span class="ds-piece" data-dif="${p.dif}" data-dash="${p.dash ? 1 : 0}">${glyphSvg(id, 20)}${esc(p.nome)}</span>`;
}

function icon(name) {
  const paths = {
    back: 'M15 5l-7 7 7 7',
    list: 'M5 7h14M5 12h14M5 17h9',
    spark: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
    play: 'M8 5l11 7-11 7z',
    down: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    flag: 'M6 21V4M6 4h11l-2 4 2 4H6',
    x: 'M6 6l12 12M18 6L6 18',
  };
  const fill = name === 'play' || name === 'spark' ? 'currentColor' : 'none';
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="${fill}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name]}"/></svg>`;
}

export { describeResult };
