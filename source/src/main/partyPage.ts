// The page guests see in Party mode (phone or computer). One self-contained HTML file in the
// app's look: liquid glass over a color field taken from the cover that's playing.
// Everything is built with textContent, so song names can't inject markup.
export function partyPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0d0e13">
<title>Pulse Party</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0d0e13; --text: #f5f5f7; --dim: rgba(235,235,245,.64); --faint: rgba(235,235,245,.4);
    --glass: rgba(30,32,44,.42); --glass-2: rgba(22,24,34,.66); --rim: rgba(255,255,255,.14);
    --accent: #ff5c93; --c1: #ff4f8b; --c2: #b03cff; --c3: #4a5cff; --c4: #2ad1c9;
    --ui: 'Figtree', 'Segoe UI', system-ui, sans-serif; --display: 'Bricolage Grotesque', 'Figtree', system-ui, sans-serif;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html { background: var(--bg); }
  html, body { margin: 0; min-height: 100%; color: var(--text); font: 15px/1.4 var(--ui); }
  body { background: transparent; }
  body { overflow-x: hidden; }
  .field-bg { position: fixed; inset: 0; z-index: -1; overflow: hidden; background: var(--bg); }
  .blob { position: absolute; width: 70vmax; height: 70vmax; border-radius: 50%; filter: blur(90px); opacity: .7; transition: background 1.2s ease; animation: drift 24s ease-in-out infinite alternate; }
  .b1 { left: -25vmax; top: -30vmax; background: var(--c1); }
  .b2 { right: -30vmax; top: -10vmax; background: var(--c3); animation-delay: -8s; }
  .b3 { left: 10vmax; bottom: -40vmax; background: var(--c2); opacity: .45; animation-delay: -16s; }
  .shade { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 0%, transparent 35%, rgba(8,8,12,.55) 100%); }
  @keyframes drift { to { transform: translate(6vmax, 4vmax) scale(1.08); } }
  @media (prefers-reduced-motion: reduce) { .blob { animation: none; } }

  .wrap { max-width: 600px; margin: 0 auto; padding: max(18px, env(safe-area-inset-top)) 16px 60px; }
  header { display: flex; align-items: center; gap: 12px; margin: 6px 0 20px; }
  .logo { width: 38px; height: 38px; border-radius: 11px; background: linear-gradient(135deg, var(--c1), var(--c2) 55%, var(--c3)); display: grid; place-items: center; box-shadow: 0 8px 24px rgba(176,60,255,.45), inset 0 1px 0 rgba(255,255,255,.45); }
  .logo svg { width: 22px; height: 22px; }
  header h1 { font: 800 24px/1 var(--display); letter-spacing: -.03em; margin: 0; }
  header .who { margin-left: auto; font-size: 13px; color: var(--dim); background: var(--glass); border: 1px solid var(--rim); padding: 6px 12px; border-radius: 999px; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); cursor: pointer; }

  .glass { background: var(--glass); border: 1px solid var(--rim); border-radius: 24px; backdrop-filter: blur(28px) saturate(140%); -webkit-backdrop-filter: blur(28px) saturate(140%); box-shadow: 0 18px 50px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.12); }

  .now { padding: 16px; display: grid; grid-template-columns: 112px 1fr; gap: 16px; align-items: center; }
  .now .art { width: 112px; height: 112px; border-radius: 16px; object-fit: cover; background: #222; box-shadow: 0 16px 40px rgba(0,0,0,.45); }
  .now .kind { font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--dim); display: flex; align-items: center; gap: 7px; }
  .eq { display: inline-flex; gap: 2px; align-items: flex-end; height: 11px; }
  .eq i { width: 3px; background: var(--accent); border-radius: 2px; animation: eq 1s ease-in-out infinite; }
  .eq i:nth-child(2) { animation-delay: -.3s } .eq i:nth-child(3) { animation-delay: -.6s }
  .eq.paused i { animation: none; height: 3px; }
  @keyframes eq { 0%,100% { height: 3px } 50% { height: 11px } }
  .now .title { font: 800 23px/1.1 var(--display); letter-spacing: -.02em; margin: 6px 0 3px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .now .artist { color: var(--dim); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar { height: 4px; border-radius: 4px; background: rgba(255,255,255,.14); margin-top: 12px; overflow: hidden; }
  .bar span { display: block; height: 100%; width: 0; background: linear-gradient(90deg, var(--c1), var(--c2)); border-radius: 4px; }
  .empty-now { grid-column: 1 / -1; color: var(--dim); padding: 8px 4px; }
  .bar { cursor: pointer; height: 6px; touch-action: none; }
  .ctrls { display: flex; align-items: center; gap: 6px; margin-top: 12px; }
  .ctrl { width: 40px; height: 40px; border-radius: 50%; border: 0; display: grid; place-items: center; color: var(--text); background: transparent; cursor: pointer; }
  .ctrl svg { width: 22px; height: 22px; }
  .ctrl:active { transform: scale(.92); }
  .ctrl.play { width: 48px; height: 48px; background: var(--text); color: #111; }
  .ctrl.play svg { width: 20px; height: 20px; }
  .x { flex: none; width: 32px; height: 32px; border-radius: 50%; border: 0; display: grid; place-items: center; background: transparent; color: var(--dim); cursor: pointer; }
  .x svg { width: 16px; height: 16px; }
  .x:active { background: rgba(255,255,255,.1); }

  .open { display: flex; align-items: center; gap: 12px; margin-top: 12px; padding: 12px 14px; text-decoration: none; color: var(--text); }
  .open .pulse { width: 34px; height: 34px; border-radius: 10px; flex: none; background: linear-gradient(135deg, var(--c1), var(--c2) 55%, var(--c3)); display: grid; place-items: center; }
  .open .pulse svg { width: 18px; height: 18px; }
  .open b { display: block; font-size: 14.5px; }
  .open span { font-size: 12.5px; color: var(--dim); }
  .open .go { margin-left: auto; font-weight: 700; font-size: 13px; color: var(--accent); white-space: nowrap; }

  .search { position: sticky; top: 10px; z-index: 5; margin: 22px 0 6px; display: flex; align-items: center; gap: 10px; padding: 0 16px; height: 52px; border-radius: 999px; }
  .search svg { width: 18px; height: 18px; flex: none; opacity: .7; }
  .search input { flex: 1; min-width: 0; height: 100%; border: 0; background: transparent; color: var(--text); font: 500 16px var(--ui); outline: none; }
  .search input::placeholder { color: var(--faint); }
  .search:focus-within { border-color: color-mix(in srgb, var(--accent) 70%, transparent); }

  h2 { font: 700 13px var(--ui); text-transform: uppercase; letter-spacing: .1em; color: var(--dim); margin: 24px 4px 8px; display: flex; align-items: center; gap: 8px; }
  h2 .count { background: rgba(255,255,255,.1); color: var(--text); border-radius: 999px; padding: 1px 8px; font-size: 11px; letter-spacing: 0; }
  .list { padding: 6px; }
  .row { display: flex; align-items: center; gap: 12px; padding: 8px; border-radius: 14px; }
  .row + .row { margin-top: 2px; }
  .row:hover { background: rgba(255,255,255,.05); }
  .row img { width: 46px; height: 46px; border-radius: 9px; object-fit: cover; background: #222; flex: none; }
  .row .n { width: 18px; text-align: center; color: var(--faint); font-weight: 600; font-size: 13px; flex: none; }
  .t { min-width: 0; flex: 1; }
  .t b { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .t span { display: block; color: var(--dim); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .t b .e { display: inline-block; font-size: 9.5px; line-height: 15px; padding: 0 4px; border-radius: 3px; background: rgba(255,255,255,.18); color: var(--text); margin-left: 6px; vertical-align: 2px; font-weight: 700; }
  .add { flex: none; height: 34px; padding: 0 16px; border-radius: 999px; border: 0; color: #fff; font: 700 14px var(--ui); background: linear-gradient(100deg, var(--c1), var(--c2)); box-shadow: 0 6px 18px rgba(255,79,139,.35), inset 0 1px 0 rgba(255,255,255,.4); cursor: pointer; }
  .add:active { transform: scale(.96); }
  .add:disabled { opacity: .55; box-shadow: none; }
  .add.done { background: rgba(255,255,255,.14); }
  .votes { flex: none; display: inline-flex; align-items: center; gap: 1px; padding: 2px; border-radius: 999px; background: rgba(255,255,255,.08); }
  .vote { width: 30px; height: 30px; border: 0; border-radius: 50%; background: transparent; font-size: 15px; cursor: pointer; filter: grayscale(.9); opacity: .7; }
  .vote.on-up { filter: none; opacity: 1; background: rgba(61,220,132,.22); }
  .vote.on-down { filter: none; opacity: 1; background: rgba(255,80,90,.22); }
  .votes b { min-width: 22px; text-align: center; font-size: 13px; color: var(--dim); }
  .votes b.up { color: #3ddc84; } .votes b.down { color: #ff6b74; }
  .by { flex: none; font-size: 12px; font-weight: 600; color: var(--text); background: rgba(255,255,255,.1); padding: 3px 10px; border-radius: 999px; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { color: var(--dim); padding: 14px 12px; font-size: 14px; }

  .toast { position: fixed; left: 50%; bottom: max(22px, env(safe-area-inset-bottom)); transform: translate(-50%, 20px); padding: 12px 20px; border-radius: 999px; font-weight: 600; font-size: 14px; opacity: 0; transition: opacity .2s, transform .2s; pointer-events: none; max-width: 90vw; text-align: center; }
  .toast.on { opacity: 1; transform: translate(-50%, 0); }

  .name { min-height: 80vh; display: grid; place-items: center; }
  .name .card { width: 100%; max-width: 420px; padding: 28px 22px; text-align: center; }
  .name h1 { font: 800 30px/1.05 var(--display); letter-spacing: -.03em; margin: 14px 0 6px; }
  .name p { color: var(--dim); margin: 0 0 18px; }
  .name input { width: 100%; height: 50px; padding: 0 18px; border-radius: 999px; border: 1px solid var(--rim); background: var(--glass-2); color: var(--text); font: 500 16px var(--ui); outline: none; margin-bottom: 12px; text-align: center; }
  .name input:focus { border-color: var(--accent); }
  .name button { width: 100%; height: 50px; border-radius: 999px; border: 0; color: #fff; font: 700 16px var(--ui); background: linear-gradient(100deg, var(--c1), var(--c2) 60%, var(--c3)); box-shadow: 0 10px 30px rgba(176,60,255,.4); cursor: pointer; }
  img { color: transparent; }
</style>
</head>
<body>
<div class="field-bg" aria-hidden="true"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div><div class="shade"></div></div>
<div class="wrap">
  <header>
    <div class="logo"><svg viewBox="0 0 64 64" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 34h10l6-14 9 28 8-20 5 6h10"/></svg></div>
    <h1>Pulse Party</h1>
    <span class="who" id="who" hidden></span>
  </header>
  <main id="app"></main>
</div>
<div class="toast glass" id="toast"></div>
<script>
const base = location.pathname.replace(/\\/$/, '');
const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const whoEl = document.getElementById('who');
let guest = '';
try { guest = localStorage.getItem('pulse-party-name') || ''; } catch (e) {}
let results = [];
let state = { nowPlaying: null, queue: [] };
let stateAt = Date.now();
let q = '';
let timer = 0;
let searching = false;
let searched = '';
let lastArt = '';
// the parts of the page that change; filled once the guest has a name
let nowBox = null, resultsBox = null, queueBox = null, queueHead = null;

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function toast(t) { toastEl.textContent = t; toastEl.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove('on'), 2600); }
function img(src, cls) { const i = el('img', cls); i.alt = ''; if (src) i.src = src; i.loading = 'lazy'; return i; }
function svg(path, fill) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', fill ? 'currentColor' : 'none'); s.setAttribute('stroke', fill ? 'none' : 'currentColor'); s.setAttribute('stroke-width', '2.2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', path); s.append(p); return s; }
const ICON = {
  play: 'M8 5.5v13l11-6.5z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  next: 'M5 6v12l8.5-6zM14 6v12l8.5-6z',
  prev: 'M19 6v12l-8.5-6zM10 6v12L1.5 12z',
  x: 'M6 6l12 12M18 6L6 18'
};

// The color field follows the cover that's playing, like in the app.
function tint(src) {
  if (!src || src === lastArt) return; lastArt = src;
  const i = new Image(); i.crossOrigin = 'anonymous';
  i.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 24; const x = c.getContext('2d'); x.drawImage(i, 0, 0, 24, 24);
      const d = x.getImageData(0, 0, 24, 24).data; const px = [];
      for (let k = 0; k < d.length; k += 4) { const r = d[k], g = d[k+1], b = d[k+2]; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); px.push({ r, g, b, s: mx - mn, l: (mx + mn) / 2 }); }
      px.sort((a, b) => b.s - a.s);
      const pick = (n) => { const p = px[Math.min(px.length - 1, n)]; return 'rgb(' + p.r + ',' + p.g + ',' + p.b + ')'; };
      const root = document.documentElement.style;
      root.setProperty('--c1', pick(0)); root.setProperty('--c2', pick(40)); root.setProperty('--c3', pick(120));
    } catch (e) {}
  };
  i.src = src;
}

function askName() {
  whoEl.hidden = true;
  nowBox = resultsBox = queueBox = queueHead = null;
  app.replaceChildren();
  const box = el('div', 'name'); const card = el('div', 'card glass');
  const lg = el('div', 'logo'); lg.style.margin = '0 auto'; lg.style.width = lg.style.height = '54px'; lg.style.borderRadius = '16px'; lg.innerHTML = document.querySelector('.logo').innerHTML;
  card.append(lg, el('h1', '', 'Join the party'));
  const input = el('input'); input.placeholder = 'Your name'; input.maxLength = 24; input.value = guest; input.autocomplete = 'nickname';
  const go = el('button', '', 'Join');
  const join = () => { const v = input.value.trim(); if (!v) return input.focus(); guest = v; try { localStorage.setItem('pulse-party-name', v); } catch (e) {} build(); };
  go.onclick = join; input.onkeydown = (e) => { if (e.key === 'Enter') join(); };
  card.append(input, go); box.append(card); app.append(box); input.focus();
}

function track(t, right, n) {
  const r = el('div', 'row');
  if (n != null) r.append(el('span', 'n', String(n)));
  const tx = el('div', 't');
  const b = el('b', '', t.name); if (t.explicit) b.append(el('span', 'e', 'E'));
  tx.append(b, el('span', '', t.artists));
  r.append(img(t.image), tx);
  if (right) for (const x of [].concat(right)) if (x) r.append(x);
  return r;
}

const inQueue = (uri) => state.queue.some((x) => x.uri === uri);

async function post(path, body) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ guest }, body)) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}

async function add(t, btn) {
  btn.disabled = true;
  try {
    await post('/api/add', { uri: t.uri });
    state.queue = state.queue.concat([{ uri: t.uri, name: t.name, artists: t.artists, image: t.image, addedBy: guest }]);
    toast('Added “' + t.name + '”');
    renderQueue(); renderResults();
    setTimeout(refresh, 800);
  } catch (e) { toast(e.message === 'Failed to fetch' ? 'The party host is not reachable.' : e.message); btn.disabled = false; }
}

// Everyone can steer the music: play/pause, skip, seek and remove songs.
async function control(body) {
  const np = state.nowPlaying;
  // show it at once; the next refresh brings the real state
  if (np && body.action === 'toggle') { np.positionMs = livePos(); stateAt = Date.now(); np.paused = !np.paused; renderNow(); }
  if (np && body.action === 'seek') { np.positionMs = body.positionMs; stateAt = Date.now(); progress(); }
  if (body.action === 'remove') { state.queue = state.queue.filter((x) => x.uri !== body.uri); renderQueue(); renderResults(); }
  try { await post('/api/control', body); }
  catch (e) { toast(e.message === 'Failed to fetch' ? 'The party host is not reachable.' : e.message); }
  setTimeout(refresh, body.action === 'next' || body.action === 'previous' ? 1500 : 700);
}

function fmt(ms) { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function livePos() { const np = state.nowPlaying; if (!np) return 0; return Math.min(np.durationMs || 0, (np.positionMs || 0) + (np.paused ? 0 : Date.now() - stateAt)); }

function ctrl(cls, icon, label, body) { const b = el('button', 'ctrl ' + cls); b.setAttribute('aria-label', label); b.append(svg(ICON[icon], true)); b.onclick = () => control(body); return b; }

function renderNow() {
  if (!nowBox) return;
  const np = state.nowPlaying;
  nowBox.replaceChildren();
  if (!np) { nowBox.append(el('div', 'empty-now', 'Nothing playing')); return; }
  tint(np.image);
  const info = el('div');
  const kind = el('div', 'kind'); const eq = el('span', 'eq' + (np.paused ? ' paused' : '')); eq.append(el('i'), el('i'), el('i'));
  kind.append(eq, document.createTextNode(np.paused ? 'Paused' : 'Now playing'));
  const bar = el('div', 'bar'); const fill = el('span'); bar.append(fill); fill.id = 'fill';
  bar.setAttribute('role', 'slider'); bar.setAttribute('aria-label', 'Seek');
  bar.onclick = (e) => { const r = bar.getBoundingClientRect(); control({ action: 'seek', positionMs: Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (np.durationMs || 0)) }); };
  const ctrls = el('div', 'ctrls');
  ctrls.append(ctrl('', 'prev', 'Previous', { action: 'previous' }), ctrl('play', np.paused ? 'play' : 'pause', np.paused ? 'Play' : 'Pause', { action: 'toggle' }), ctrl('', 'next', 'Next', { action: 'next' }));
  info.append(kind, el('div', 'title', np.name), el('div', 'artist', np.artists), bar, ctrls);
  nowBox.append(img(np.image, 'art'), info);
  progress();
}

function renderResults() {
  if (!resultsBox) return;
  resultsBox.replaceChildren();
  if (q.trim().length < 2) return;
  resultsBox.append(el('h2', '', 'Results'));
  const list = el('div', 'list glass');
  if (!results.length) list.append(el('div', 'empty', searching || searched !== q.trim() ? 'Searching…' : 'No songs found.'));
  for (const t of results) {
    const done = inQueue(t.uri);
    const b = el('button', 'add' + (done ? ' done' : ''), done ? 'Added' : 'Add'); b.disabled = done;
    b.onclick = () => add(t, b); list.append(track(t, b));
  }
  resultsBox.append(list);
}

function renderQueue() {
  if (!queueBox) return;
  queueHead.replaceChildren(document.createTextNode('Up next'));
  if (state.queue.length) queueHead.append(el('span', 'count', String(state.queue.length)));
  queueBox.replaceChildren();
  if (!state.queue.length) queueBox.append(el('div', 'empty', 'Nothing queued'));
  state.queue.forEach((t, i) => {
    const x = el('button', 'x'); x.setAttribute('aria-label', 'Remove ' + t.name); x.append(svg(ICON.x)); x.onclick = () => control({ action: 'remove', uri: t.uri });
    queueBox.append(track(t, [t.addedBy ? el('span', 'by', t.addedBy) : null, voteBox(t), x], i + 1));
  });
}

// Thumbs up or down: the best voted songs play first, and a song voted down enough leaves.
let myVotes = {};
try { myVotes = JSON.parse(localStorage.getItem('pulse-party-votes') || '{}'); } catch (e) {}
function voteBox(t) {
  const box = el('span', 'votes');
  const mine = myVotes[t.uri] || 0;
  const score = t.score || 0;
  const up = el('button', 'vote' + (mine > 0 ? ' on-up' : ''), '👍'); up.setAttribute('aria-label', 'Thumbs up');
  const down = el('button', 'vote' + (mine < 0 ? ' on-down' : ''), '👎'); down.setAttribute('aria-label', 'Thumbs down');
  const n = el('b', score > 0 ? 'up' : score < 0 ? 'down' : '', score > 0 ? '+' + score : String(score));
  const cast = async (v) => {
    const next = (myVotes[t.uri] || 0) === v ? 0 : v;
    const before = myVotes[t.uri] || 0;
    myVotes[t.uri] = next;
    try { localStorage.setItem('pulse-party-votes', JSON.stringify(myVotes)); } catch (e) {}
    t.score = (t.score || 0) - before + next;
    renderQueue();
    try { await post('/api/vote', { uri: t.uri, v: next }); }
    catch (e) { toast(e.message === 'Failed to fetch' ? 'The party host is not reachable.' : e.message); }
    setTimeout(refresh, 600);
  };
  up.onclick = () => cast(1); down.onclick = () => cast(-1);
  box.append(up, n, down);
  return box;
}

function openInApp() {
  const a = el('a', 'open glass');
  a.href = 'pulsemusic://join?u=' + encodeURIComponent(location.origin + base);
  const p = el('span', 'pulse'); p.innerHTML = document.querySelector('.logo').innerHTML;
  const tx = el('div'); tx.append(el('b', '', 'Listen along in Pulse Music'));
  a.append(p, tx, el('span', 'go', 'Open'));
  return a;
}

// Builds the page once; later updates only touch the parts that changed, so typing in the
// search field is never interrupted.
function build() {
  if (!guest) return askName();
  whoEl.hidden = false; whoEl.textContent = guest; whoEl.title = 'Change name'; whoEl.onclick = () => { guest = ''; askName(); };
  app.replaceChildren();
  nowBox = el('section', 'now glass');
  const s = el('div', 'search glass');
  s.append(svg('M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5'));
  const input = el('input'); input.placeholder = 'Search for a song'; input.value = q; input.type = 'search'; input.enterKeyHint = 'search';
  input.oninput = () => { q = input.value; results = []; searching = q.trim().length >= 2; clearTimeout(timer); timer = setTimeout(doSearch, 450); renderResults(); };
  s.append(input);
  resultsBox = el('div');
  queueHead = el('h2');
  queueBox = el('div', 'list glass');
  app.append(nowBox, openInApp(), s, resultsBox, queueHead, queueBox);
  renderNow(); renderResults(); renderQueue();
}

function progress() {
  const f = document.getElementById('fill'); const np = state.nowPlaying;
  if (!f || !np || !np.durationMs) return;
  f.style.width = Math.min(100, (livePos() / np.durationMs) * 100) + '%';
}
setInterval(progress, 500);

async function doSearch() {
  const term = q.trim();
  if (term.length < 2) { results = []; searching = false; return renderResults(); }
  searching = true;
  let found = [];
  try {
    const res = await fetch(base + '/api/search?q=' + encodeURIComponent(term));
    const j = await res.json();
    if (res.ok) found = j.tracks || []; else toast(j.error || (res.status === 429 ? 'Slow down a little.' : 'Search failed.'));
  } catch (e) { toast('The party host is not reachable.'); }
  if (term !== q.trim()) return; // a newer search is on its way
  results = found; searched = term; searching = false;
  renderResults();
}

let lastNow = '';
async function refresh() {
  try {
    const res = await fetch(base + '/api/state');
    if (!res.ok) return;
    const next = await res.json();
    const np = next.nowPlaying;
    // redraw the card only when the song or play/pause changed; the bar moves on its own
    const key = np ? np.uri + '|' + np.paused : '';
    state = next; stateAt = Date.now();
    if (key !== lastNow) { lastNow = key; renderNow(); } else progress();
    renderQueue(); renderResults();
  } catch (e) {}
}
build(); refresh(); setInterval(refresh, 3000);
</script>
</body>
</html>`
}
