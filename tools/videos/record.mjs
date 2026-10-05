// Gravador das vídeo-aulas do APOLVEN.
// Cada aula: cartão de abertura → passos (ação na tela + falas). Cada fala tem áudio próprio (Kokoro pf_dora),
// aparece como legenda na tela e entra no .vtt com o mesmo tempo.
// Uso:
//   node record.mjs texts                → out/texts.json (falas para o TTS)
//   node record.mjs rec [n...] [--dry]   → out/raw/<file>.webm + out/raw/<file>.json (linha do tempo)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import pg from 'pg';
import { LESSONS, MODULES } from './lessons.mjs';

const B = 'http://apolven.lorler.com.br';
const API = 'http://127.0.0.1:3334';
const OUT = path.resolve('out');
const [mode, ...rest] = process.argv.slice(2);
const DRY = rest.includes('--dry');
const only = rest.filter((x) => /^\d+$/.test(x)).map(Number);
fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });

const idOf = (n, i, j) => `${String(n).padStart(2, '0')}-${i}-${j}`;
const chunks = (say) => (Array.isArray(say) ? say : say ? [say] : []);

if (mode === 'texts') {
  const items = [];
  for (const l of LESSONS) {
    items.push({ id: idOf(l.n, 'i', 0), text: l.intro || `Aula ${l.n}. ${l.title}.` });
    l.steps.forEach((s, i) => chunks(s.say).forEach((t, j) => items.push({ id: idOf(l.n, i, j), text: t })));
  }
  fs.writeFileSync(path.join(OUT, 'texts.json'), JSON.stringify(items, null, 1));
  console.log(items.length, 'falas');
  process.exit(0);
}

const durs = DRY ? {} : JSON.parse(fs.readFileSync(path.join(OUT, 'tts', 'durations.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newDemo() {
  const db = new pg.Client('postgres://postgres:postgres@localhost:5432/apolven');
  await db.connect(); await db.query('delete from apolven.rate_limits'); await db.end();
  const r = await fetch(`${API}/api/auth/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const j = await r.json();
  if (!j.token) throw new Error('demo: ' + JSON.stringify(j));
  return j.token;
}

function apiClient(token) {
  return async (method, p, body, headers = {}) => {
    const r = await fetch(`${API}/api${p}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (r.status >= 400) console.warn(`  [api ${method} ${p}] ${r.status} ${text.slice(0, 300)}`);
    return data;
  };
}

// --- camada visual injetada na página (legenda, destaque, cursor, cartões) ---
const OVERLAY = () => {
  if (window.__av) return;
  const css = document.createElement('style');
  css.textContent = `
  #av-cap{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);max-width:min(1040px,86vw);z-index:2147483646;
    background:rgba(10,16,32,.9);color:#fff;font:600 21px/1.35 Inter,system-ui,sans-serif;padding:12px 22px;border-radius:14px;
    box-shadow:0 10px 30px rgba(0,0,0,.35);text-align:center;transition:opacity .2s;pointer-events:none}
  #av-cap:empty{opacity:0}
  #av-spot{position:fixed;z-index:2147483645;border:3px solid #f59e0b;border-radius:12px;box-shadow:0 0 0 6px rgba(245,158,11,.25),0 0 24px rgba(245,158,11,.55);
    pointer-events:none;transition:all .35s ease;opacity:0}
  #av-cur{position:fixed;z-index:2147483647;width:26px;height:26px;margin:-4px 0 0 -4px;pointer-events:none;transition:left .55s ease,top .55s ease;left:640px;top:420px}
  #av-cur svg{filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
  #av-cur.click::after{content:'';position:absolute;left:-10px;top:-10px;width:40px;height:40px;border-radius:50%;background:rgba(29,78,216,.35);animation:avp .45s ease-out}
  @keyframes avp{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
  #av-card{position:fixed;inset:0;z-index:2147483644;display:flex;flex-direction:column;justify-content:center;padding:0 110px;color:#fff;
    background:radial-gradient(1200px 700px at 85% 10%,rgba(96,165,250,.35),transparent),linear-gradient(135deg,#0b1f5c,#1d4ed8 60%,#2563eb);font-family:Inter,system-ui,sans-serif;transition:opacity .5s}
  #av-card .k{display:flex;align-items:center;gap:14px;font:700 22px/1 Inter,system-ui;letter-spacing:.08em;opacity:.95}
  #av-card .k span.l{width:46px;height:46px;border-radius:12px;background:#fff;display:grid;place-items:center}
  #av-card .n{margin-top:48px;font:700 26px/1 Inter,system-ui;color:#bfdbfe}
  #av-card h1{margin:14px 0 0;font:800 60px/1.08 Inter,system-ui;max-width:1000px}
  #av-card p{margin:22px 0 0;font:400 26px/1.4 Inter,system-ui;max-width:900px;color:#dbeafe}
  #av-card .m{position:absolute;bottom:56px;left:110px;font:600 18px/1 Inter,system-ui;color:#bfdbfe}`;
  document.head.appendChild(css);
  const mk = (id, html = '') => { const e = document.createElement('div'); e.id = id; e.innerHTML = html; document.body.appendChild(e); return e; };
  const cap = mk('av-cap');
  const spot = mk('av-spot');
  const cur = mk('av-cur', '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.3-3.4-6.8L5 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>');
  window.__av = {
    cap: (t) => { cap.textContent = t || ''; },
    spot: (r) => { if (!r) { spot.style.opacity = 0; return; } Object.assign(spot.style, { left: `${r.x - 7}px`, top: `${r.y - 7}px`, width: `${r.width + 14}px`, height: `${r.height + 14}px`, opacity: 1 }); },
    move: (x, y) => { cur.style.left = `${x}px`; cur.style.top = `${y}px`; },
    click: () => { cur.classList.remove('click'); void cur.offsetWidth; cur.classList.add('click'); },
    card: (h) => { let c = document.getElementById('av-card'); if (!h) { if (c) { c.style.opacity = 0; setTimeout(() => c.remove(), 520); } return; } if (!c) c = mk('av-card'); c.innerHTML = h; },
  };
  // a camada some se o app recriar o body: reinstala
  new MutationObserver(() => { for (const e of [cap, spot, cur]) if (!e.isConnected) document.body.appendChild(e); }).observe(document.body, { childList: true });
};

function helpers(page, api, tl, t0) {
  const ensure = () => page.evaluate(OVERLAY);
  const now = () => (Date.now() - t0) / 1000;
  const warn = (m) => { console.warn(`  ! ${m}`); tl.warnings.push(m); };
  const loc = (target) => (typeof target === 'string' ? page.getByText(target, { exact: true }).locator('visible=true').first() : target.first());
  const settle = async (ms = 500) => { await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {}); await sleep(ms); await ensure(); };
  const h = {
    page, api, now, warn, settle, sleep,
    async go(route) { await page.goto(B + route); await settle(700); },
    async find(target, { timeout = 4000 } = {}) {
      const l = loc(target);
      try { await l.waitFor({ state: 'visible', timeout }); return l; } catch { warn(`não achei: ${typeof target === 'string' ? target : target.toString()}`); return null; }
    },
    async spot(target, { pad = true } = {}) {
      const l = await h.find(target); if (!l) return null;
      await l.scrollIntoViewIfNeeded().catch(() => {}); await sleep(250);
      const r = await l.boundingBox();
      if (r) { await page.evaluate(([b]) => window.__av.spot(b), [r]); await page.evaluate(([x, y]) => window.__av.move(x, y), [r.x + Math.min(r.width / 2, 60), r.y + r.height / 2]); }
      await sleep(pad ? 600 : 100);
      return l;
    },
    async unspot() { await page.evaluate(() => window.__av?.spot(null)); },
    async click(target, { wait = 700 } = {}) {
      const l = await h.spot(target, { pad: false }); if (!l) return false;
      await sleep(450); await page.evaluate(() => window.__av.click());
      await l.click().catch((e) => warn(`clique falhou: ${e.message.split('\n')[0]}`));
      await h.unspot(); await settle(wait); return true;
    },
    async label(text) { return h.find(page.getByLabel(text, { exact: false })); },
    async type(target, value, { delay = 45 } = {}) {
      const l = typeof target === 'string' ? await h.label(target) : await h.find(target); if (!l) return;
      await l.scrollIntoViewIfNeeded().catch(() => {});
      const r = await l.boundingBox(); if (r) await page.evaluate(([x, y]) => window.__av.move(x, y), [r.x + 30, r.y + r.height / 2]);
      await l.click().catch(() => {}); await l.fill(''); await l.pressSequentially(String(value), { delay });
      await sleep(250);
    },
    async select(labelText, option) {
      const l = await h.label(labelText); if (!l) return;
      await l.scrollIntoViewIfNeeded().catch(() => {});
      await l.selectOption(typeof option === 'string' ? { label: option } : option).catch((e) => warn(`select ${labelText}: ${e.message.split('\n')[0]}`));
      await sleep(400);
    },
    async scroll(dy, ms = 900) {
      await page.evaluate(([d]) => {
        const sc = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) { const st = getComputedStyle(x); if (/(auto|scroll)/.test(st.overflowY) && x.scrollHeight > x.clientHeight + 5) return x; } return null; };
        const can = (e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 5;
        const dlg = [...document.querySelectorAll('.fixed.inset-0 > .card')].filter((e) => e.offsetParent).pop();
        const t = (dlg && [dlg, ...dlg.querySelectorAll('*')].find(can)) || sc(document.elementFromPoint(760, 420)) || document.scrollingElement;
        t.scrollBy({ top: d, behavior: 'smooth' });
      }, [dy]);
      await sleep(ms);
    },
    async top() { await page.evaluate(() => { document.querySelectorAll('main, .overflow-y-auto').forEach((e) => e.scrollTo({ top: 0, behavior: 'smooth' })); window.scrollTo({ top: 0, behavior: 'smooth' }); }); await sleep(600); },
    async fill(labelText, value) { const l = await h.label(labelText); if (l) { await l.scrollIntoViewIfNeeded().catch(() => {}); await l.fill(String(value)); await sleep(300); } },
    async esc() { await page.keyboard.press('Escape'); await sleep(400); },
    async firstLink(prefix) {
      const href = await page.evaluate((p) => [...document.querySelectorAll('a')].filter((a) => a.offsetParent).map((a) => a.getAttribute('href')).find((x) => x && x.startsWith(p) && x.length > p.length + 5 && !x.endsWith('/nova')), prefix);
      return href;
    },
  };
  return h;
}

async function speak(page, tl, t0, id, text) {
  await page.evaluate(([t]) => window.__av.cap(t), [text]);
  const at = (Date.now() - t0) / 1000;
  tl.cues.push({ id, text, at });
  const d = DRY ? 0.4 : durs[id];
  if (d == null) throw new Error(`sem áudio para ${id}`);
  await sleep(d * 1000 + 260);
}

async function recordLesson(browser, l) {
  const token = await newDemo();
  const api = apiClient(token);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    recordVideo: DRY ? undefined : { dir: path.join(OUT, 'raw', 'tmp'), size: { width: 1280, height: 800 } } });
  await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await ctx.addInitScript(([t]) => { try { localStorage.setItem('apolven.token', t); } catch { /* */ } }, [token]);
  const page = await ctx.newPage();
  const t0 = Date.now();
  const tl = { n: l.n, file: l.file, cues: [], warnings: [], start: 0, end: 0 };
  const h = helpers(page, api, tl, t0);
  page.on('pageerror', (e) => h.warn(`pageerror ${e.message}`));
  const state = l.setup ? await l.setup(api, h) : {};
  h.state = state;
  await h.go(l.start || '/');
  await page.evaluate(() => document.querySelector('[aria-label="Fechar"]')?.click());
  // cartão de abertura
  await page.evaluate(([n, title, desc, mod]) => window.__av.card(`<div class="k"><span class="l"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg></span>APOLVEN · TREINAMENTO</div><div class="n">Aula ${n} · ${mod}</div><h1>${title}</h1><p>${desc}</p><div class="m">Dados fictícios da demonstração</div>`), [l.n, l.title, l.desc, MODULES.find((m) => m.key === l.mod)?.label || '']);
  await sleep(400);
  tl.start = (Date.now() - t0) / 1000 - 0.15;
  await speak(page, tl, t0, idOf(l.n, 'i', 0), l.intro || `Aula ${l.n}. ${l.title}.`);
  await sleep(500);
  await page.evaluate(() => window.__av.card(null));
  await sleep(650);
  for (const [i, s] of l.steps.entries()) {
    if (s.act) { try { await s.act(h, state); } catch (e) { h.warn(`passo ${i}: ${e.message.split('\n')[0]}`); } }
    for (const [j, t] of chunks(s.say).entries()) await speak(page, tl, t0, idOf(l.n, i, j), t);
    if (s.after) { try { await s.after(h, state); } catch (e) { h.warn(`após ${i}: ${e.message.split('\n')[0]}`); } }
    if (DRY) await page.screenshot({ path: path.join(OUT, 'dry', `${l.file}-${String(i).padStart(2, '0')}.png`) });
  }
  await page.evaluate(() => window.__av.cap(''));
  await sleep(900);
  tl.end = (Date.now() - t0) / 1000;
  const video = page.video();
  await ctx.close();
  if (video) {
    const src = await video.path();
    fs.renameSync(src, path.join(OUT, 'raw', `${l.file}.webm`));
  }
  fs.writeFileSync(path.join(OUT, 'raw', `${l.file}.json`), JSON.stringify(tl, null, 1));
  console.log(`aula ${l.n} ${l.file}: ${(tl.end - tl.start).toFixed(1)}s, ${tl.warnings.length} aviso(s)`);
}

if (mode === 'rec') {
  if (DRY) fs.mkdirSync(path.join(OUT, 'dry'), { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', env: { ...process.env, LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR' }, args: ['--lang=pt-BR', '--host-resolver-rules=MAP apolven.lorler.com.br 127.0.0.1', '--no-proxy-server'] });
  for (const l of LESSONS.filter((x) => !only.length || only.includes(x.n))) {
    try { await recordLesson(browser, l); } catch (e) { console.error(`aula ${l.n} falhou:`, e); }
  }
  await browser.close();
}
