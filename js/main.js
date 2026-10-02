// ROOK & ROLL — controller: screens, settings, the match loop (human ↔ CPU / friend), items, input.
import { Stage } from './stage.js?v=1';
import { loadCore, ensureArena } from './assets.js?v=1';
import { Game } from './game.js?v=1';
import * as C from './chess.js?v=1';
import { ITEM_PICKS } from './items.js?v=1';
import { ARENA_IDS, CONFIG } from './arenas.js?v=1';
import { TYPE_NAMES } from './board.js?v=1';
import { t, setLang, detectLang, getLang, LANGS } from './i18n.js?v=1';
import { pieceShot, itemShot, arenaShot } from './thumbs.js?v=1';
import * as audio from './audio.js?v=1';
import { sleep, finishAllTweens } from './util.js?v=1';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

// ---------------------------------------------------------------- saved settings + trophies
const SAVE_KEY = 'rook-n-roll-v1';
const save = (() => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { /* private mode */ }
  return Object.assign({ lang: detectLang(), music: true, sound: true, quality: matchMedia('(pointer: coarse)').matches ? 'low' : 'high', rotate2p: true,
    arena: 'candy', mode: 'cpu', level: 1, side: 'light', items: true, trophies: {} }, s);
})();
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* ignore */ } }
if (params.has('mute')) { save.music = false; save.sound = false; }

// ---------------------------------------------------------------- state
const LEVEL_KEYS = ['easy', 'medium', 'hard'];
let stage, game = null, match = 0;
const S = { screen: 'loading', busy: false, human: [true, false], selected: -1, targets: [], itemMode: null, hint: null, viewSide: 'light', arenaShown: null };

// ---------------------------------------------------------------- AI worker (falls back to the main thread)
let worker = null, jobId = 0;
const waiting = new Map();
function ai(job) {
  if (!worker) {
    try {
      worker = new Worker(new URL('./ai-worker.js?v=1', import.meta.url), { type: 'module' });
      worker.onmessage = e => { const w = waiting.get(e.data.id); if (w) { waiting.delete(e.data.id); e.data.ok ? w.res(e.data.result) : w.rej(e.data.error); } };
      worker.onerror = () => { worker = 'none'; for (const w of waiting.values()) w.rej('worker'); waiting.clear(); };
    } catch { worker = 'none'; }
  }
  if (worker === 'none') return import('./ai.js?v=1').then(m => m.decide(job));
  const id = ++jobId;
  return new Promise((res, rej) => { waiting.set(id, { res, rej }); worker.postMessage({ id, job }); })
    .catch(() => import('./ai.js?v=1').then(m => m.decide(job)));
}

// ---------------------------------------------------------------- screens & modals
function show(name) {
  S.screen = name;
  for (const s of $$('.screen')) s.classList.toggle('show', s.dataset.screen === name);
}
function modal(id, on = true) { $('#' + id).classList.toggle('show', on); }
const anyModal = () => $$('.modal.show').length > 0;
let toastTimer = 0;
function toast(msg, ms = 1800) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms); }

function applyArenaTheme(id) { document.body.dataset.arena = id; document.querySelector('meta[name=theme-color]').content = { candy: '#ff7eb8', spooky: '#2a2140', galaxy: '#1a1250' }[id]; }

async function showArena(id, { pieces = true } = {}) {
  await ensureArena(id);
  if (S.arenaShown !== id) { await stage.setArena(id); S.arenaShown = id; }
  applyArenaTheme(id);
  if (pieces) { stage.board.setPosition(C.fromFEN().board, null); stage.board.setBoxes([], false); stage.board.clearMarks(); }
}

// ---------------------------------------------------------------- UI building
function buildLangChips() {
  for (const box of [$('#title-langs'), $('#set-langs')]) {
    box.innerHTML = '';
    for (const L of LANGS) {
      const b = document.createElement('button'); b.className = 'chip' + (L.id === getLang() ? ' on' : ''); b.textContent = L.label;
      b.onclick = () => { audio.sfx('click'); save.lang = L.id; persist(); setLang(L.id); buildLangChips(); refreshTexts(); };
      box.appendChild(b);
    }
  }
}
function refreshTexts() {
  buildArenaCards(); buildHowto();
  if (S.screen === 'play' && game) updateHud();
}
function cupsHtml(arena) {
  const tr = save.trophies[arena] || {};
  return ['🥉', '🥈', '🥇'].map((c, i) => `<span class="c ${tr[LEVEL_KEYS[i]] ? 'won' : ''}" title="${t('cup_' + LEVEL_KEYS[i])}">${c}</span>`).join('');
}
function buildArenaCards() {
  const box = $('#arena-cards'); box.innerHTML = '';
  for (const id of ARENA_IDS) {
    const b = document.createElement('button');
    b.className = 'arena-card' + (save.arena === id ? ' on' : ''); b.dataset.arena = id;
    let img = '';
    try { img = arenaShot(id); } catch { /* not loaded yet */ }
    b.innerHTML = `${img ? `<img src="${img}" alt="">` : ''}<div class="cups">${cupsHtml(id)}</div><div class="meta"><b>${t('arena_' + id)}</b><small>${t('arenaDesc_' + id)}</small></div>`;
    b.onclick = async () => {
      audio.sfx('select'); save.arena = id; persist();
      for (const c of $$('.arena-card')) c.classList.toggle('on', c.dataset.arena === id);
      await showArena(id); audio.music(CONFIG[id].music);
    };
    box.appendChild(b);
  }
}
function syncSegs() {
  const vals = { mode: save.mode, level: String(save.level), side: save.side, items: save.items ? 'on' : 'off' };
  for (const seg of $$('.seg[data-opt]')) for (const b of $$('button', seg)) b.classList.toggle('on', b.dataset.v === vals[seg.dataset.opt]);
  for (const el of $$('[data-cpu-only]')) el.classList.toggle('hidden', save.mode !== 'cpu');
  const sv = { music: save.music ? 'on' : 'off', sound: save.sound ? 'on' : 'off', quality: save.quality, rotate2p: save.rotate2p ? 'on' : 'off' };
  for (const seg of $$('.seg[data-set]')) for (const b of $$('button', seg)) b.classList.toggle('on', b.dataset.v === sv[seg.dataset.set]);
}
function buildHowto() {
  const items = $('#howto-items'); items.innerHTML = '';
  for (const id of ['shield', 'freeze', 'bomb', 'warp', 'boost']) {
    const d = document.createElement('div');
    d.innerHTML = `<img src="${itemShot(id)}" alt=""><span><b>${t('item_' + id)}</b>${t('itemDesc_' + id)}</span>`;
    items.appendChild(d);
  }
  const pcs = $('#howto-pieces'); pcs.innerHTML = '';
  const arena = save.arena;
  for (const type of ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king']) {
    const d = document.createElement('div');
    let src = ''; try { src = pieceShot(arena, type, 'light'); } catch { /* loading */ }
    d.innerHTML = `<img src="${src}" alt=""><span><b>${t(`name_${arena}_${type}`)}</b>${t('role_' + type)}</span>`;
    pcs.appendChild(d);
  }
}

// ---------------------------------------------------------------- the match
function sideName(sideIdx) {
  if (save.mode === 'pvp') return t(sideIdx === 0 ? 'p1' : 'p2');
  return S.human[sideIdx] ? t('you') : t('rival_' + save.arena);
}
const teamOf = sideIdx => sideIdx === 0 ? 'light' : 'dark';

async function startMatch() {
  const my = ++match;
  modal('m-result', false); modal('m-pause', false);
  finishAllTweens();
  await showArena(save.arena, { pieces: false });
  if (my !== match) return;
  game = new Game({ itemsOn: save.items });
  let side = save.side === 'random' ? (Math.random() < 0.5 ? 'light' : 'dark') : save.side;
  S.human = save.mode === 'pvp' ? [true, true] : [side === 'light', side === 'dark'];
  S.viewSide = save.mode === 'pvp' ? 'light' : side;
  S.selected = -1; S.targets = []; S.itemMode = null; S.hint = null; S.busy = true;
  stage.board.setPosition(game.s.board, null);
  stage.board.setBoxes([], false);
  stage.board.clearMarks();
  stage.auto = 0;
  show('play'); setupCards(); updateHud();
  $('#moves').classList.remove('show');
  audio.music(CONFIG[save.arena].music);
  await stage.view(S.viewSide, { sweep: 'intro', dur: 2.0 });
  if (my !== match) return;
  // kart-race countdown, then the item boxes drop in
  const cd = $('#countdown');
  for (const n of ['3', '2', '1']) { cd.innerHTML = `<span>${n}</span>`; audio.sfx('count'); await sleep(650); if (my !== match) return; }
  cd.innerHTML = `<span class="go">${t('go')}</span>`; audio.sfx('go');
  setTimeout(() => { if (cd.firstChild?.classList.contains('go')) cd.innerHTML = ''; }, 900);
  stage.board.setBoxes(game.boxes, true);
  S.busy = false;
  nextTurn();
}

function setupCards() {
  const meIdx = S.viewSide === 'light' ? 0 : 1;
  S.cardFor = [null, null];
  S.cardFor[meIdx] = $('#card-me'); S.cardFor[1 - meIdx] = $('#card-rival');
  for (const i of [0, 1]) {
    const card = S.cardFor[i];
    card.querySelector('.avatar').src = pieceShot(save.arena, 'king', teamOf(i));
    card.querySelector('.slot').onclick = () => onSlot(i);
  }
}

function updateHud() {
  if (!game) return;
  const idx = game.idx();
  for (const i of [0, 1]) {
    const card = S.cardFor[i];
    card.querySelector('.pname').textContent = sideName(i);
    const diff = (game.material(i ? C.BLACK : C.WHITE) - game.material(i ? C.WHITE : C.BLACK)) / 100;
    card.querySelector('.pmat').textContent = diff > 0 ? `+${Math.round(diff)}` : '';
    card.classList.toggle('active', idx === i && !game.result);
    const slot = card.querySelector('.slot'), id = game.held[i];
    if (!slot.classList.contains('spin')) {
      slot.classList.toggle('has', !!id);
      if (id) slot.querySelector('img').src = itemShot(id);
      slot.title = id ? `${t('item_' + id)} — ${t('itemDesc_' + id)}` : t('noItem');
    }
    slot.classList.toggle('ready', !!id && idx === i && S.human[i] && !game.itemUsed && !game.result);
    slot.style.display = game.itemsOn ? '' : 'none';
  }
  const turn = $('#turn');
  if (game.result) { turn.textContent = ''; turn.style.visibility = 'hidden'; }
  else {
    turn.style.visibility = '';
    const humanTurn = S.human[idx];
    turn.classList.toggle('wait', !humanTurn);
    if (save.mode === 'pvp') turn.textContent = t('turnOf', { name: sideName(idx) });
    else if (humanTurn) turn.textContent = t('yourTurn');
    else turn.innerHTML = `${sideName(idx)} <span class="dots">${t('thinking')}</span>`;
  }
  $('[data-act=undo]').disabled = !(game.history.length >= 2) || !!game.result;
  $('[data-act=hint]').disabled = !!game.result;
  // move list: one row per full move; an item used before a move sits next to it
  const rows = [];
  let k = 0;
  for (const e of game.log) {
    const row = Math.floor(k / 2);
    (rows[row] ||= ['', '']);
    rows[row][k % 2] += e.san + ' ';
    if (!e.item) k++;
  }
  const ol = $('#move-list');
  ol.innerHTML = rows.map(r => `<li><span>${r[0]}</span><span>${r[1]}</span></li>`).join('');
  ol.parentElement.scrollTop = 1e6;
}

function kingSq(side) { return game.s.kings[side >> 3]; }

function nextTurn() {
  if (!game) return;
  stage.board.refreshEffects(game);
  const fz = game.s.frozen;
  if (fz && game.s.ply < fz.until && game.frozenSq() < 0 && game.s.board[fz.sq]) toast(t('iceMelted'));
  updateHud();
  if (game.result) return endGame();
  const side = game.side, idx = side >> 3;
  stage.board.show('check', C.inCheck(game.s) ? [kingSq(side)] : []);
  if (C.inCheck(game.s)) {
    audio.sfx('check'); stage.board.shakeKing(kingSq(side));
    stage.fx.word(t('check'), stage.board.pieces.get(kingSq(side))?.root.position.clone().setY(2.2) || new (stage.camera.position.constructor)(0, 2, 0), 'check');
  }
  if (S.human[idx]) {
    game.markTurn();
    updateHud();
    if (save.mode === 'pvp' && save.rotate2p) {
      const want = idx === 0 ? 'light' : 'dark';
      if (want !== S.viewSide) { S.viewSide = want; S.busy = true; stage.view(want, { sweep: true, dur: 1.1 }).then(() => { S.busy = false; }); }
    }
  } else cpuTurn();
}

async function cpuTurn() {
  const my = match;
  S.busy = true;
  const side = game.side, idx = side >> 3;
  const job = { state: C.serialize(game.s), level: save.level, boxes: game.boxes.slice(), held: game.held[idx], itemsOn: game.itemsOn, seed: Math.random() };
  let res;
  try { [res] = await Promise.all([ai(job), sleep(650 + Math.random() * 500)]); }
  catch (e) { console.error(e); res = { item: null, move: game.legal()[0] }; }
  if (my !== match || !game || game.result) return;
  if (res.item) {
    toast(t('cpuUsed', { name: sideName(idx), item: t('item_' + res.item.id) }));
    await doItem({ a: res.item.a, b: res.item.b ?? -1 }, res.item.promo || C.QUEEN);
    if (my !== match || game.result) return;
  }
  let m = res.move;
  if (!game.legal().includes(m)) m = game.legal()[0];
  await doMove(m);
}

async function doMove(m) {
  const my = match;
  S.busy = true;
  clearSelection();
  stage.board.clearMarks('hint', 'check');
  const ev = game.move(m);
  stage.board.show('last', [ev.from, ev.to]);
  updateHud();
  await stage.board.playMove(ev);
  if (my !== match) return;
  if (ev.pickup) await roulette(ev.side >> 3, ev.pickup);
  if (ev.spawned) stage.board.setBoxes(game.boxes, true);
  S.busy = false;
  nextTurn();
}

async function doItem(target, promo) {
  const side = game.side, idx = side >> 3;
  const fx = game.useItem(target, promo);
  updateHud();
  stage.board.clearMarks('item', 'itemfill', 'dot', 'cap', 'sel', 'hint');
  const fromZ = (side === C.WHITE ? 1 : -1) * 6.2;
  await stage.board.playItem(fx, game, fromZ);
  if (fx.pickup) await roulette(idx, fx.pickup);
  stage.board.refreshEffects(game);
  updateHud();
  if (fx.status?.over) { S.busy = false; nextTurn(); }
}

// Mario-Kart-style item roulette in the player's slot
async function roulette(idx, id) {
  const slot = S.cardFor[idx].querySelector('.slot'), img = slot.querySelector('img');
  const ids = ['shield', 'freeze', 'bomb', 'warp', 'boost'];
  slot.classList.add('spin', 'has'); slot.classList.remove('ready');
  let k = Math.floor(Math.random() * 5), delay = 55;
  while (delay < 230) { img.src = itemShot(ids[k++ % 5]); audio.sfx('tick'); await sleep(delay); delay *= 1.16; }
  img.src = itemShot(id);
  slot.classList.remove('spin'); slot.classList.add('got'); setTimeout(() => slot.classList.remove('got'), 500);
  audio.sfx('got');
  toast(S.human[idx] ? t('gotItem', { item: t('item_' + id) }) : t('cpuGotItem', { name: sideName(idx), item: t('item_' + id) }));
  updateHud();
}

// ---------------------------------------------------------------- input on the board
function clearSelection() {
  S.selected = -1; S.targets = [];
  stage.board.clearMarks('dot', 'cap', 'sel', 'hover');
}
function select(sq) {
  clearSelection();
  const moves = game.legalFrom(sq);
  S.selected = sq; S.targets = moves;
  stage.board.show('sel', [sq]);
  const tos = [...new Set(moves.map(C.to))];
  const isCap = to => game.s.board[to] || moves.some(m => C.to(m) === to && C.flagOf(m) === 2);
  stage.board.show('dot', tos.filter(x => !isCap(x)));
  stage.board.show('cap', tos.filter(isCap));
  stage.board.select(sq, true);
  if (!moves.length) {
    if (game.frozenSq() === sq) toast('❄');
    audio.sfx('error');
  }
}
const humanTurn = () => game && !game.result && S.human[game.idx()] && !S.busy && !anyModal();

async function onTap(sq) {
  if (!humanTurn() || sq < 0) return;
  if (S.itemMode) return onItemTap(sq);
  const side = game.side;
  const p = game.s.board[sq];
  if (S.selected >= 0) {
    const ms = S.targets.filter(m => C.to(m) === sq);
    if (ms.length) {
      let m = ms[0];
      if (ms.length > 1) { const type = await choosePromo(); m = ms.find(x => C.promoOf(x) === type) || ms[0]; }
      return doMove(m);
    }
  }
  if (p && (p & 8) === side) { if (S.selected === sq) { clearSelection(); audio.sfx('deselect'); } else { select(sq); } return; }
  clearSelection();
}

function choosePromo() {
  return new Promise(res => {
    const box = $('#promo-choices'); box.innerHTML = '';
    const team = teamOf(game.idx());
    for (const type of [C.QUEEN, C.ROOK, C.BISHOP, C.KNIGHT]) {
      const name = TYPE_NAMES[type];
      const b = document.createElement('button');
      b.innerHTML = `<img src="${pieceShot(save.arena, name, team)}" alt=""><span>${t(`name_${save.arena}_${name}`)}</span>`;
      b.onclick = () => { audio.sfx('select'); modal('m-promo', false); res(type); };
      box.appendChild(b);
    }
    modal('m-promo', true);
  });
}

// items: tap your slot → pick target square(s)
function onSlot(idx) {
  if (!game || game.idx() !== idx || !S.human[idx]) { if (game?.held[idx]) toast(`${t('item_' + game.held[idx])}: ${t('itemDesc_' + game.held[idx])}`, 2600); return; }
  if (!humanTurn()) return;
  const id = game.held[idx];
  if (!id) { toast(t('noItem')); return; }
  if (S.itemMode) return cancelItem();
  if (game.itemUsed) { toast(t('usedThisTurn')); audio.sfx('error'); return; }
  const targets = game.itemTargets();
  if (!targets.length) { toast(t('cantUse')); audio.sfx('error'); return; }
  audio.sfx('select');
  clearSelection();
  S.itemMode = { id, targets, first: -1 };
  const banner = $('#item-banner');
  banner.querySelector('img').src = itemShot(id);
  banner.querySelector('b').textContent = t('item_' + id);
  banner.querySelector('span').textContent = `${t('itemDesc_' + id)} ${t('pickTarget')}.`;
  banner.classList.add('show');
  const firsts = [...new Set(targets.map(x => x.a))];
  stage.board.show('item', firsts); stage.board.show('itemfill', firsts);
}
function cancelItem() {
  S.itemMode = null;
  $('#item-banner').classList.remove('show');
  stage.board.clearMarks('item', 'itemfill');
}
async function onItemTap(sq) {
  const im = S.itemMode;
  if (ITEM_PICKS[im.id] === 2 && im.first >= 0) {
    const tg = im.targets.find(x => x.a === im.first && x.b === sq) || im.targets.find(x => x.b === im.first && x.a === sq);
    if (!tg) { if (im.targets.some(x => x.a === sq)) { im.first = -1; } else { audio.sfx('error'); return; } }
    else { cancelItem(); S.busy = true; await doItem(tg); S.busy = false; updateHud(); return; }
  }
  const options = im.targets.filter(x => x.a === sq);
  if (!options.length) { audio.sfx('error'); return; }
  if (ITEM_PICKS[im.id] === 2) {
    im.first = sq;
    audio.sfx('select');
    const seconds = im.targets.filter(x => x.a === sq).map(x => x.b).concat(im.targets.filter(x => x.b === sq).map(x => x.a));
    stage.board.show('item', [sq, ...new Set(seconds)]); stage.board.show('itemfill', [sq]);
    $('#item-banner span').textContent = t('pickSecond');
    return;
  }
  const tg = options[0];
  let promo = C.QUEEN;
  if (im.id === 'boost' && ((tg.b >> 4) === 7 || (tg.b >> 4) === 0)) { cancelItem(); promo = await choosePromo(); }
  cancelItem(); S.busy = true;
  await doItem(tg, promo);
  S.busy = false; updateHud();
}

// ---------------------------------------------------------------- end of game
async function endGame() {
  const my = match;
  const r = game.result;
  S.busy = true; clearSelection(); cancelItem();
  stage.board.clearMarks('check');
  const winner = r.result === '1-0' ? 0 : r.result === '0-1' ? 1 : -1;
  if (r.reason === 'mate') await stage.board.checkmate(kingSq(winner === 0 ? C.BLACK : C.WHITE), teamOf(winner));
  else if (winner >= 0) stage.board.celebrate(teamOf(winner));
  await sleep(winner >= 0 ? 1600 : 700);
  if (my !== match) return;
  let title, cup = '🤝', trophy = '';
  if (winner < 0) { title = t('draw'); audio.sfx('draw'); }
  else if (save.mode === 'pvp') { title = t('winsName', { name: sideName(winner) }); cup = '🏆'; audio.sfx('win'); }
  else if (S.human[winner]) {
    title = t('win'); audio.sfx('win');
    const key = LEVEL_KEYS[save.level];
    cup = ['🥉', '🥈', '🥇'][save.level];
    const tr = (save.trophies[save.arena] ||= {});
    if (!tr[key]) { tr[key] = true; persist(); }
    trophy = t('trophy', { cup: t('cup_' + key) });
  } else { title = t('lose'); cup = '💫'; audio.sfx('lose'); }
  $('#res-title').textContent = title;
  $('#res-cup').textContent = cup;
  $('#res-reason').textContent = t('reason_' + r.reason);
  $('#res-trophy').textContent = trophy;
  const me = S.human[0] ? 0 : 1;
  $('#res-stats').textContent = t('stats', { moves: Math.ceil(game.s.ply / 2), caps: game.stats.captures[me], items: game.stats.items[me] });
  const i = ARENA_IDS.indexOf(save.arena);
  $('[data-act=next-arena]').classList.toggle('hidden', i === ARENA_IDS.length - 1);
  updateHud();
  modal('m-result', true);
}

function resign() {
  if (!game || game.result) return;
  const me = save.mode === 'pvp' ? game.idx() : (S.human[0] ? 0 : 1);
  game.result = { over: true, result: me === 0 ? '0-1' : '1-0', reason: 'resign' };
  ++match; S.busy = false;
  endGame();
}

function undo() {
  if (!game || S.busy || game.history.length < 2 || game.result) return;
  audio.sfx('deselect');
  cancelItem(); clearSelection();
  game.history.pop();
  game.restore(game.history.pop());
  stage.board.syncTo(game);
  stage.board.clearMarks();
  nextTurn();
}

async function hint() {
  if (!humanTurn()) return;
  const my = match;
  S.busy = true; $('[data-act=hint]').disabled = true;
  try {
    const res = await ai({ state: C.serialize(game.s), level: 2, boxes: game.boxes, held: null, itemsOn: false, seed: 1 });
    if (my !== match) return;
    stage.board.show('hint', [C.from(res.move), C.to(res.move)]);
    select(C.from(res.move));
  } finally { if (my === match) { S.busy = false; updateHud(); } }
}

// ---------------------------------------------------------------- buttons
const actions = {
  play: () => { show('select'); syncSegs(); buildArenaCards(); stage.auto = 0.06; },
  back: () => { show('title'); stage.auto = 0.08; },
  start: () => startMatch(),
  howto: () => { buildHowto(); modal('m-howto'); },
  settings: () => { syncSegs(); buildLangChips(); modal('m-settings'); },
  'close-modal': e => e.target.closest('.modal').classList.remove('show'),
  pause: () => { if (game && !game.result) modal('m-pause'); },
  resume: () => modal('m-pause', false),
  restart: () => { modal('m-pause', false); startMatch(); },
  resign: () => { modal('m-pause', false); modal('m-confirm'); },
  'confirm-yes': () => { modal('m-confirm', false); resign(); },
  'confirm-no': () => modal('m-confirm', false),
  quit: async () => {
    ++match; game = null; S.busy = false; cancelItem();
    for (const m of $$('.modal')) m.classList.remove('show');
    show('title'); stage.board.clearMarks(); await showArena(save.arena); stage.auto = 0.08; audio.music('menu');
  },
  rematch: () => startMatch(),
  'next-arena': () => { const i = ARENA_IDS.indexOf(save.arena); save.arena = ARENA_IDS[Math.min(i + 1, ARENA_IDS.length - 1)]; persist(); startMatch(); },
  undo, hint,
  moves: () => $('#moves').classList.toggle('show'),
  'cancel-item': () => { cancelItem(); audio.sfx('deselect'); },
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  audio.unlock();
  if (b.dataset.act !== 'cancel-item') audio.sfx('click');
  actions[b.dataset.act]?.(e);
});
for (const seg of $$('.seg[data-opt]')) seg.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  audio.sfx('click');
  const k = seg.dataset.opt, v = b.dataset.v;
  if (k === 'level') save.level = +v; else if (k === 'items') save.items = v === 'on'; else save[k] = v;
  persist(); syncSegs();
});
for (const seg of $$('.seg[data-set]')) seg.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const k = seg.dataset.set, v = b.dataset.v;
  if (k === 'music') { save.music = v === 'on'; audio.setMusic(save.music); }
  if (k === 'sound') { save.sound = v === 'on'; audio.setSfx(save.sound); }
  if (k === 'quality') { save.quality = v; stage.setQuality(v); }
  if (k === 'rotate2p') save.rotate2p = v === 'on';
  audio.sfx('click');
  persist(); syncSegs();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (S.itemMode) return cancelItem();
    const open = $$('.modal.show').filter(m => m.id !== 'm-result' && m.id !== 'm-promo');
    if (open.length) return open.forEach(m => m.classList.remove('show'));
    if (S.screen === 'play') actions.pause();
  }
  if (S.screen === 'play' && !anyModal()) {
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) undo();
    if (e.key === 'h') hint();
  }
});

// pointer: tap vs drag (dragging orbits the camera)
let down = null;
const canvas = $('#view');
canvas.addEventListener('pointerdown', e => { audio.unlock(); down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', e => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
  down = null;
  if (moved < 9 && dt < 600 && S.screen === 'play') onTap(stage.pick(e.clientX, e.clientY));
});
let hoverSq = -1;
canvas.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse' || S.screen !== 'play' || !humanTurn() || down) return;
  const sq = stage.pick(e.clientX, e.clientY);
  if (sq === hoverSq) return;
  hoverSq = sq;
  const own = sq >= 0 && game.s.board[sq] && (game.s.board[sq] & 8) === game.side;
  const target = S.targets.some(m => C.to(m) === sq) || (S.itemMode && S.itemMode.targets.some(x => x.a === sq || x.b === sq));
  stage.board.show('hover', own || target ? [sq] : []);
  canvas.style.cursor = own || target ? 'pointer' : 'grab';
});

// ---------------------------------------------------------------- boot
async function boot() {
  setLang(save.lang);
  audio.setMusic(save.music); audio.setSfx(save.sound);
  applyArenaTheme(save.arena);
  stage = new Stage(canvas, $('#overlay'), save.quality);
  const bar = $('#load-bar');
  try {
    await loadCore(save.arena, p => { bar.style.width = Math.round(p * 90) + '%'; });
  } catch (e) {
    console.error(e);
    $('[data-screen=loading] .muted').textContent = 'Could not load the 3D models. Check your connection and reload.';
    return;
  }
  await showArena(save.arena);
  bar.style.width = '100%';
  stage.view('light');
  stage.auto = 0.08;
  let last = performance.now();
  const loop = () => { last = performance.now(); stage.frame(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  // when the page is shown but not painted (embedded previews), keep the game clock moving anyway
  setInterval(() => { if (performance.now() - last > 250) { last = performance.now(); stage.frame(); } }, 40);
  buildLangChips(); syncSegs();
  await sleep(250);
  show('title');
  const startMusic = () => { audio.unlock(); audio.music('menu'); window.removeEventListener('pointerdown', startMusic); window.removeEventListener('keydown', startMusic); };
  window.addEventListener('pointerdown', startMusic); window.addEventListener('keydown', startMusic);
  if (DEBUG) {
    window.snap = () => {
      stage.frame();
      let img = document.getElementById('snapimg');
      if (!img) { img = document.createElement('img'); img.id = 'snapimg'; img.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;object-fit:cover;pointer-events:none'; canvas.after(img); }
      img.src = stage.renderer.domElement.toDataURL('image/jpeg', 0.85); img.style.display = '';
      return 'ok';
    };
    window.unsnap = () => { const img = document.getElementById('snapimg'); if (img) img.style.display = 'none'; };
    window.__rnr = { stage, get game() { return game; }, S, save, C, startMatch, doMove, doItem, actions, show, showArena,
      play: async (...sans) => { for (const s of sans) { const m = game.legal().find(x => C.san(game.s, x).replace(/[+#]/, '') === s.replace(/[+#]/, '')); if (!m) throw new Error('no move ' + s); await doMove(m); } } };
  }
}
boot();
