// Chess rules + search for ROOK & ROLL. No DOM, no Three.js: the same module runs on the page and in the AI worker.
// Board: 0x88 mailbox (index = rank * 16 + file, a1 = 0, h8 = 119). Piece = type | colour (WHITE 0, BLACK 8).
// Moves are packed ints: from | to << 7 | promo << 14 | flag << 17  (flag: 1 double push, 2 en passant, 3 castle).
// Item effects that live inside the rules: a bubble shield (that piece can't be captured until its owner moves again)
// and a freeze (that piece can't move on its owner's next turn; the ice melts if it would leave no legal move).
export const WHITE = 0, BLACK = 8;
export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const MATE = 30000;

const N_OFF = [33, 31, 18, 14, -33, -31, -18, -14];
const K_OFF = [1, -1, 16, -16, 17, 15, -17, -15];
const B_OFF = [17, 15, -17, -15];
const R_OFF = [1, -1, 16, -16];
const FL_DOUBLE = 1, FL_EP = 2, FL_CASTLE = 3;

export const from = m => m & 127;
export const to = m => (m >> 7) & 127;
export const promoOf = m => (m >> 14) & 7;
export const flagOf = m => (m >> 17) & 3;
const enc = (f, t, p = 0, fl = 0) => f | (t << 7) | (p << 14) | (fl << 17);

export const fileOf = sq => sq & 7;
export const rankOf = sq => sq >> 4;
export const sqName = sq => 'abcdefgh'[sq & 7] + ((sq >> 4) + 1);
export const sqFrom = (file, rank) => rank * 16 + file;
export const onBoard = sq => !(sq & 0x88);
export const ALL_SQUARES = [];
for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) ALL_SQUARES.push(r * 16 + f);

// castling rights: 1 white short, 2 white long, 4 black short, 8 black long; a move from/to a square keeps rights & mask
const CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[4] = 15 & ~3; CASTLE_MASK[0] = 15 & ~2; CASTLE_MASK[7] = 15 & ~1;
CASTLE_MASK[116] = 15 & ~12; CASTLE_MASK[112] = 15 & ~8; CASTLE_MASK[119] = 15 & ~4;

// ---------------------------------------------------------------- zobrist (two 32-bit halves)
let seed = 0x9e3779b9;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
const Z_LO = new Uint32Array(16 * 128), Z_HI = new Uint32Array(16 * 128);
for (let i = 0; i < Z_LO.length; i++) { Z_LO[i] = rnd(); Z_HI[i] = rnd(); }
const ZC_LO = new Uint32Array(16), ZC_HI = new Uint32Array(16);
for (let i = 0; i < 16; i++) { ZC_LO[i] = rnd(); ZC_HI[i] = rnd(); }
const ZE_LO = new Uint32Array(8), ZE_HI = new Uint32Array(8);
for (let i = 0; i < 8; i++) { ZE_LO[i] = rnd(); ZE_HI[i] = rnd(); }
const ZS_LO = rnd(), ZS_HI = rnd();

// ---------------------------------------------------------------- state
export function emptyState() {
  return {
    board: new Int8Array(128), side: WHITE, castle: 0, ep: -1, half: 0, full: 1, ply: 0,
    kings: [-1, -1], lo: 0, hi: 0, hist: [],
    shield: null,   // { sq, side, until }  — active while ply < until
    frozen: null,   // { sq, until }
    // undo stack
    u: { cap: [], castle: [], ep: [], half: [], lo: [], hi: [], shield: [], move: [] },
  };
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const LETTERS = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };

export function fromFEN(fen = START_FEN) {
  const s = emptyState();
  const [pos, side, castle, ep, half, full] = fen.trim().split(/\s+/);
  let r = 7, f = 0;
  for (const ch of pos) {
    if (ch === '/') { r--; f = 0; continue; }
    if (/\d/.test(ch)) { f += +ch; continue; }
    const t = LETTERS[ch.toLowerCase()], c = ch === ch.toLowerCase() ? BLACK : WHITE;
    s.board[r * 16 + f] = t | c;
    if (t === KING) s.kings[c >> 3] = r * 16 + f;
    f++;
  }
  s.side = side === 'b' ? BLACK : WHITE;
  s.castle = (castle.includes('K') ? 1 : 0) | (castle.includes('Q') ? 2 : 0) | (castle.includes('k') ? 4 : 0) | (castle.includes('q') ? 8 : 0);
  s.ep = ep && ep !== '-' ? sqFrom(ep.charCodeAt(0) - 97, +ep[1] - 1) : -1;
  s.half = +half || 0; s.full = +full || 1;
  rehash(s);
  s.hist = [s.lo];
  return s;
}

export function toFEN(s) {
  let out = '';
  for (let r = 7; r >= 0; r--) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = s.board[r * 16 + f];
      if (!p) { empty++; continue; }
      if (empty) { out += empty; empty = 0; }
      const ch = ' pnbrqk'[p & 7];
      out += p & 8 ? ch : ch.toUpperCase();
    }
    if (empty) out += empty;
    if (r) out += '/';
  }
  const c = (s.castle & 1 ? 'K' : '') + (s.castle & 2 ? 'Q' : '') + (s.castle & 4 ? 'k' : '') + (s.castle & 8 ? 'q' : '');
  return `${out} ${s.side ? 'b' : 'w'} ${c || '-'} ${s.ep >= 0 ? sqName(s.ep) : '-'} ${s.half} ${s.full}`;
}

export function rehash(s) {
  let lo = 0, hi = 0;
  for (const sq of ALL_SQUARES) {
    const p = s.board[sq];
    if (p) { lo ^= Z_LO[p * 128 + sq]; hi ^= Z_HI[p * 128 + sq]; }
    if ((p & 7) === KING) s.kings[p >> 3] = sq;
  }
  lo ^= ZC_LO[s.castle]; hi ^= ZC_HI[s.castle];
  if (s.ep >= 0) { lo ^= ZE_LO[s.ep & 7]; hi ^= ZE_HI[s.ep & 7]; }
  if (s.side) { lo ^= ZS_LO; hi ^= ZS_HI; }
  s.lo = lo >>> 0; s.hi = hi >>> 0;
}

// plain-object copy (for the worker and for undo snapshots)
export function serialize(s) {
  return {
    board: Array.from(s.board), side: s.side, castle: s.castle, ep: s.ep, half: s.half, full: s.full, ply: s.ply,
    hist: s.hist.slice(), shield: s.shield && { ...s.shield }, frozen: s.frozen && { ...s.frozen },
  };
}
export function deserialize(o) {
  const s = emptyState();
  s.board.set(o.board);
  Object.assign(s, { side: o.side, castle: o.castle, ep: o.ep, half: o.half, full: o.full, ply: o.ply });
  s.shield = o.shield ? { ...o.shield } : null;
  s.frozen = o.frozen ? { ...o.frozen } : null;
  rehash(s);
  s.hist = o.hist ? o.hist.slice() : [s.lo];
  return s;
}
export const clone = s => deserialize(serialize(s));

// ---------------------------------------------------------------- attacks
export function attacked(s, sq, by) {
  const b = s.board;
  // pawns
  if (by === WHITE) {
    let t = sq - 15; if (!(t & 0x88) && b[t] === (PAWN | WHITE)) return true;
    t = sq - 17; if (!(t & 0x88) && b[t] === (PAWN | WHITE)) return true;
  } else {
    let t = sq + 15; if (!(t & 0x88) && b[t] === (PAWN | BLACK)) return true;
    t = sq + 17; if (!(t & 0x88) && b[t] === (PAWN | BLACK)) return true;
  }
  for (let i = 0; i < 8; i++) {
    let t = sq + N_OFF[i]; if (!(t & 0x88) && b[t] === (KNIGHT | by)) return true;
    t = sq + K_OFF[i]; if (!(t & 0x88) && b[t] === (KING | by)) return true;
  }
  for (let i = 0; i < 4; i++) {
    const d = B_OFF[i];
    for (let t = sq + d; !(t & 0x88); t += d) {
      const p = b[t];
      if (p) { if ((p & 8) === by && ((p & 7) === BISHOP || (p & 7) === QUEEN)) return true; break; }
    }
    const e = R_OFF[i];
    for (let t = sq + e; !(t & 0x88); t += e) {
      const p = b[t];
      if (p) { if ((p & 8) === by && ((p & 7) === ROOK || (p & 7) === QUEEN)) return true; break; }
    }
  }
  return false;
}

export const inCheck = (s, side = s.side) => attacked(s, s.kings[side >> 3], side ^ 8);

// ---------------------------------------------------------------- move generation
const shieldedFor = (s, side) => (s.shield && s.ply < s.shield.until && s.shield.side !== side) ? s.shield.sq : -1;
const frozenNow = s => (s.frozen && s.ply < s.frozen.until) ? s.frozen.sq : -1;

// pseudo-legal moves into `out` (an array), returns count. capsOnly: captures + queen promotions (for quiescence).
export function genPseudo(s, out, capsOnly = false, ignoreFrozen = false) {
  const b = s.board, side = s.side, them = side ^ 8;
  const shielded = shieldedFor(s, side), frozen = ignoreFrozen ? -1 : frozenNow(s);
  let n = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = b[sq];
    if (!p || (p & 8) !== side || sq === frozen) continue;
    const type = p & 7;
    if (type === PAWN) {
      const dir = side === WHITE ? 16 : -16, r = sq >> 4;
      const promoRank = side === WHITE ? 6 : 1, startRank = side === WHITE ? 1 : 6;
      const t = sq + dir;
      if (!(t & 0x88) && !b[t]) {
        if (r === promoRank) {
          out[n++] = enc(sq, t, QUEEN);
          if (!capsOnly) { out[n++] = enc(sq, t, KNIGHT); out[n++] = enc(sq, t, ROOK); out[n++] = enc(sq, t, BISHOP); }
        } else if (!capsOnly) {
          out[n++] = enc(sq, t);
          if (r === startRank && !b[t + dir]) out[n++] = enc(sq, t + dir, 0, FL_DOUBLE);
        }
      }
      for (const cd of [dir - 1, dir + 1]) {
        const c = sq + cd;
        if (c & 0x88) continue;
        if (b[c] && (b[c] & 8) === them) {
          if (c === shielded) continue;
          if (r === promoRank) {
            out[n++] = enc(sq, c, QUEEN);
            if (!capsOnly) { out[n++] = enc(sq, c, KNIGHT); out[n++] = enc(sq, c, ROOK); out[n++] = enc(sq, c, BISHOP); }
          } else out[n++] = enc(sq, c);
        } else if (c === s.ep && (c - dir) !== shielded) out[n++] = enc(sq, c, 0, FL_EP);
      }
    } else if (type === KNIGHT || type === KING) {
      const offs = type === KNIGHT ? N_OFF : K_OFF;
      for (let i = 0; i < 8; i++) {
        const t = sq + offs[i];
        if (t & 0x88) continue;
        const q = b[t];
        if (!q) { if (!capsOnly) out[n++] = enc(sq, t); }
        else if ((q & 8) === them && t !== shielded) out[n++] = enc(sq, t);
      }
      if (type === KING && !capsOnly) {
        if (side === WHITE && sq === 4) {
          if ((s.castle & 1) && !b[5] && !b[6] && b[7] === (ROOK | WHITE) && !attacked(s, 4, them) && !attacked(s, 5, them) && !attacked(s, 6, them)) out[n++] = enc(4, 6, 0, FL_CASTLE);
          if ((s.castle & 2) && !b[3] && !b[2] && !b[1] && b[0] === (ROOK | WHITE) && !attacked(s, 4, them) && !attacked(s, 3, them) && !attacked(s, 2, them)) out[n++] = enc(4, 2, 0, FL_CASTLE);
        } else if (side === BLACK && sq === 116) {
          if ((s.castle & 4) && !b[117] && !b[118] && b[119] === (ROOK | BLACK) && !attacked(s, 116, them) && !attacked(s, 117, them) && !attacked(s, 118, them)) out[n++] = enc(116, 118, 0, FL_CASTLE);
          if ((s.castle & 8) && !b[115] && !b[114] && !b[113] && b[112] === (ROOK | BLACK) && !attacked(s, 116, them) && !attacked(s, 115, them) && !attacked(s, 114, them)) out[n++] = enc(116, 114, 0, FL_CASTLE);
        }
      }
    } else {
      const offs = type === BISHOP ? B_OFF : type === ROOK ? R_OFF : K_OFF;
      const cnt = type === QUEEN ? 8 : 4;
      for (let i = 0; i < cnt; i++) {
        const d = offs[i];
        for (let t = sq + d; !(t & 0x88); t += d) {
          const q = b[t];
          if (!q) { if (!capsOnly) out[n++] = enc(sq, t); continue; }
          if ((q & 8) === them && t !== shielded) out[n++] = enc(sq, t);
          break;
        }
      }
    }
  }
  return n;
}

export function makeMove(s, m) {
  const b = s.board, f = m & 127, t = (m >> 7) & 127, promo = (m >> 14) & 7, flag = (m >> 17) & 3;
  const side = s.side, p = b[f];
  let cap = b[t], lo = s.lo, hi = s.hi;
  const u = s.u;
  u.cap.push(cap); u.castle.push(s.castle); u.ep.push(s.ep); u.half.push(s.half);
  u.lo.push(lo); u.hi.push(hi); u.shield.push(s.shield ? s.shield.sq : -1); u.move.push(m);

  if (cap) { lo ^= Z_LO[cap * 128 + t]; hi ^= Z_HI[cap * 128 + t]; }
  if (flag === FL_EP) {
    const cs = t + (side === WHITE ? -16 : 16);
    cap = b[cs]; b[cs] = 0;
    lo ^= Z_LO[cap * 128 + cs]; hi ^= Z_HI[cap * 128 + cs];
  } else if (flag === FL_CASTLE) {
    let rf, rt;
    if (t === 6) { rf = 7; rt = 5; } else if (t === 2) { rf = 0; rt = 3; } else if (t === 118) { rf = 119; rt = 117; } else { rf = 112; rt = 115; }
    const r = b[rf]; b[rt] = r; b[rf] = 0;
    lo ^= Z_LO[r * 128 + rf] ^ Z_LO[r * 128 + rt]; hi ^= Z_HI[r * 128 + rf] ^ Z_HI[r * 128 + rt];
  }
  const np = promo ? (promo | side) : p;
  b[t] = np; b[f] = 0;
  lo ^= Z_LO[p * 128 + f] ^ Z_LO[np * 128 + t]; hi ^= Z_HI[p * 128 + f] ^ Z_HI[np * 128 + t];
  if ((p & 7) === KING) s.kings[side >> 3] = t;

  lo ^= ZC_LO[s.castle]; hi ^= ZC_HI[s.castle];
  s.castle &= CASTLE_MASK[f] & CASTLE_MASK[t];
  lo ^= ZC_LO[s.castle]; hi ^= ZC_HI[s.castle];
  if (s.ep >= 0) { lo ^= ZE_LO[s.ep & 7]; hi ^= ZE_HI[s.ep & 7]; }
  s.ep = flag === FL_DOUBLE ? (f + t) >> 1 : -1;
  if (s.ep >= 0) { lo ^= ZE_LO[s.ep & 7]; hi ^= ZE_HI[s.ep & 7]; }
  s.half = ((p & 7) === PAWN || cap) ? 0 : s.half + 1;
  if (side === BLACK) s.full++;
  s.side = side ^ 8; lo ^= ZS_LO; hi ^= ZS_HI;
  s.lo = lo >>> 0; s.hi = hi >>> 0;
  s.ply++;
  if (s.shield && s.shield.sq === f) s.shield.sq = t;
  s.hist.push(s.lo);
  // remember what was captured for unmake (ep captures live on another square)
  u.cap[u.cap.length - 1] = cap;
}

export function unmakeMove(s) {
  const u = s.u, b = s.board;
  const m = u.move.pop(), cap = u.cap.pop();
  const f = m & 127, t = (m >> 7) & 127, promo = (m >> 14) & 7, flag = (m >> 17) & 3;
  s.side ^= 8;
  const side = s.side;
  const p = promo ? (PAWN | side) : b[t];
  b[f] = p;
  if (flag === FL_EP) { b[t] = 0; b[t + (side === WHITE ? -16 : 16)] = cap; }
  else b[t] = cap;
  if (flag === FL_CASTLE) {
    let rf, rt;
    if (t === 6) { rf = 7; rt = 5; } else if (t === 2) { rf = 0; rt = 3; } else if (t === 118) { rf = 119; rt = 117; } else { rf = 112; rt = 115; }
    b[rf] = b[rt]; b[rt] = 0;
  }
  if ((p & 7) === KING) s.kings[side >> 3] = f;
  s.castle = u.castle.pop(); s.ep = u.ep.pop(); s.half = u.half.pop();
  s.lo = u.lo.pop(); s.hi = u.hi.pop();
  const sh = u.shield.pop();
  if (s.shield) s.shield.sq = sh;
  if (side === BLACK) s.full--;
  s.ply--;
  s.hist.pop();
}

// null move for the search (pass the turn)
function makeNull(s) {
  const u = s.u;
  u.cap.push(0); u.castle.push(s.castle); u.ep.push(s.ep); u.half.push(s.half);
  u.lo.push(s.lo); u.hi.push(s.hi); u.shield.push(s.shield ? s.shield.sq : -1); u.move.push(0);
  let lo = s.lo, hi = s.hi;
  if (s.ep >= 0) { lo ^= ZE_LO[s.ep & 7]; hi ^= ZE_HI[s.ep & 7]; }
  s.ep = -1; s.side ^= 8; lo ^= ZS_LO; hi ^= ZS_HI;
  s.lo = lo >>> 0; s.hi = hi >>> 0; s.ply++; s.half++;
  s.hist.push(s.lo);
}
function unmakeNull(s) {
  const u = s.u;
  u.move.pop(); u.cap.pop(); u.shield.pop();
  s.castle = u.castle.pop(); s.ep = u.ep.pop(); s.half = u.half.pop();
  s.lo = u.lo.pop(); s.hi = u.hi.pop();
  s.side ^= 8; s.ply--; s.hist.pop();
}

const _buf = new Int32Array(256);
// fully legal moves for the side to move. With a freeze active and no other move left, the ice melts.
export function legalMoves(s, ignoreFrozen = false) {
  const n = genPseudo(s, _buf, false, ignoreFrozen), out = [], side = s.side;
  for (let i = 0; i < n; i++) {
    const m = _buf[i];
    makeMove(s, m);
    if (!attacked(s, s.kings[side >> 3], s.side)) out.push(m);
    unmakeMove(s);
  }
  if (!out.length && !ignoreFrozen && frozenNow(s) >= 0) return legalMoves(s, true);
  return out;
}

// the freeze only matters while it still leaves a move; the page shows "ice melted" otherwise
export function freezeHolds(s) {
  if (frozenNow(s) < 0) return false;
  const n = genPseudo(s, _buf, false, false), side = s.side;
  for (let i = 0; i < n; i++) {
    makeMove(s, _buf[i]);
    const ok = !attacked(s, s.kings[side >> 3], s.side);
    unmakeMove(s);
    if (ok) return true;
  }
  return false;
}

export function perft(s, depth) {
  if (depth === 0) return 1;
  const moves = legalMoves(s, true);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) { makeMove(s, m); n += perft(s, depth - 1); unmakeMove(s); }
  return n;
}

// ---------------------------------------------------------------- game status
export function insufficient(s) {
  let minors = 0, bishopsColor = new Set(), others = 0;
  for (const sq of ALL_SQUARES) {
    const p = s.board[sq], t = p & 7;
    if (!p || t === KING) continue;
    if (t === KNIGHT) minors++;
    else if (t === BISHOP) { minors++; bishopsColor.add(((sq >> 4) + (sq & 7)) & 1); }
    else others++;
  }
  if (others) return false;
  if (minors <= 1) return true;
  // only bishops, all on one colour
  let knights = 0;
  for (const sq of ALL_SQUARES) if ((s.board[sq] & 7) === KNIGHT) knights++;
  return knights === 0 && bishopsColor.size === 1;
}

export function repetitions(s) {
  let n = 0;
  const h = s.hist, last = h.length - 1;
  for (let i = last; i >= 0 && i >= last - s.half; i -= 2) if (h[i] === s.lo) n++;
  return n;
}

// { over, result: '1-0' | '0-1' | '1/2', reason }
export function status(s) {
  const moves = legalMoves(s);
  const check = inCheck(s);
  if (!moves.length) {
    if (check) return { over: true, result: s.side === WHITE ? '0-1' : '1-0', reason: 'mate', check };
    return { over: true, result: '1/2', reason: 'stalemate', check };
  }
  if (insufficient(s)) return { over: true, result: '1/2', reason: 'material', check };
  if (s.half >= 100) return { over: true, result: '1/2', reason: 'fifty', check };
  if (repetitions(s) >= 3) return { over: true, result: '1/2', reason: 'repetition', check };
  return { over: false, check, moves };
}

// ---------------------------------------------------------------- notation
const SAN_LETTER = ['', '', 'N', 'B', 'R', 'Q', 'K'];
export function san(s, m, legal = legalMoves(s)) {
  const f = from(m), t = to(m), p = s.board[f], type = p & 7, flag = flagOf(m);
  let out;
  if (flag === FL_CASTLE) out = (t & 7) === 6 ? 'O-O' : 'O-O-O';
  else {
    const cap = s.board[t] || flag === FL_EP;
    if (type === PAWN) {
      out = (cap ? 'abcdefgh'[f & 7] + 'x' : '') + sqName(t);
      if (promoOf(m)) out += '=' + SAN_LETTER[promoOf(m)];
    } else {
      let dis = '';
      const rivals = legal.filter(o => o !== m && to(o) === t && (s.board[from(o)] & 7) === type);
      if (rivals.length) {
        const sameFile = rivals.some(o => (from(o) & 7) === (f & 7));
        const sameRank = rivals.some(o => (from(o) >> 4) === (f >> 4));
        if (!sameFile) dis = 'abcdefgh'[f & 7];
        else if (!sameRank) dis = String((f >> 4) + 1);
        else dis = sqName(f);
      }
      out = SAN_LETTER[type] + dis + (cap ? 'x' : '') + sqName(t);
    }
  }
  makeMove(s, m);
  const st = legalMoves(s);
  if (inCheck(s)) out += st.length ? '+' : '#';
  unmakeMove(s);
  return out;
}

// ---------------------------------------------------------------- evaluation (PeSTO tapered tables)
const MG_VAL = [0, 82, 337, 365, 477, 1025, 0], EG_VAL = [0, 94, 281, 297, 512, 936, 0];
const PHASE = [0, 0, 1, 1, 2, 4, 0];
export const VALUE = [0, 100, 320, 330, 500, 900, 20000];
// tables are written rank 8 first (a8..h8, …, a1..h1) from White's point of view
const MG = [null,
  [0,0,0,0,0,0,0,0, 98,134,61,95,68,126,34,-11, -6,7,26,31,65,56,25,-20, -14,13,6,21,23,12,17,-23, -27,-2,-5,12,17,6,10,-25, -26,-4,-4,-10,3,3,33,-12, -35,-1,-20,-23,-15,24,38,-22, 0,0,0,0,0,0,0,0],
  [-167,-89,-34,-49,61,-97,-15,-107, -73,-41,72,36,23,62,7,-17, -47,60,37,65,84,129,73,44, -9,17,19,53,37,69,18,22, -13,4,16,13,28,19,21,-8, -23,-9,12,10,19,17,25,-16, -29,-53,-12,-3,-1,18,-14,-19, -105,-21,-58,-33,-17,-28,-19,-23],
  [-29,4,-82,-37,-25,-42,7,-8, -26,16,-18,-13,30,59,18,-47, -16,37,43,40,35,50,37,-2, -4,5,19,50,37,37,7,-2, -6,13,13,26,34,12,10,4, 0,15,15,15,14,27,18,10, 4,15,16,0,7,21,33,1, -33,-3,-14,-21,-13,-12,-39,-21],
  [32,42,32,51,63,9,31,43, 27,32,58,62,80,67,26,44, -5,19,26,36,17,45,61,16, -24,-11,7,26,24,35,-8,-20, -36,-26,-12,-1,9,-7,6,-23, -45,-25,-16,-17,3,0,-5,-33, -44,-16,-20,-9,-1,11,-6,-71, -19,-13,1,17,16,7,-37,-26],
  [-28,0,29,12,59,44,43,45, -24,-39,-5,1,-16,57,28,54, -13,-17,7,8,29,56,47,57, -27,-27,-16,-16,-1,17,-2,1, -9,-26,-9,-10,-2,-4,3,-3, -14,2,-11,-2,-5,2,14,5, -35,-8,11,2,8,15,-3,1, -1,-18,-9,10,-15,-25,-31,-50],
  [-65,23,16,-15,-56,-34,2,13, 29,-1,-20,-7,-8,-4,-38,-29, -9,24,2,-16,-20,6,22,-22, -17,-20,-12,-27,-30,-25,-14,-36, -49,-1,-27,-39,-46,-44,-33,-51, -14,-14,-22,-46,-44,-30,-15,-27, 1,7,-8,-64,-43,-16,9,8, -15,36,12,-54,8,-28,24,14],
];
const EG = [null,
  [0,0,0,0,0,0,0,0, 178,173,158,134,147,132,165,187, 94,100,85,67,56,53,82,84, 32,24,13,5,-2,4,17,17, 13,9,-3,-7,-7,-8,3,-1, 4,7,-6,1,0,-5,-1,-8, 13,8,8,10,13,0,2,-7, 0,0,0,0,0,0,0,0],
  [-58,-38,-13,-28,-31,-27,-63,-99, -25,-8,-25,-2,-9,-25,-24,-52, -24,-20,10,9,-1,-9,-19,-41, -17,3,22,22,22,11,8,-18, -18,-6,16,25,16,17,4,-18, -23,-3,-1,15,10,-3,-20,-22, -42,-20,-10,-5,-2,-20,-23,-44, -29,-51,-23,-15,-22,-18,-50,-64],
  [-14,-21,-11,-8,-7,-9,-17,-24, -8,-4,7,-12,-3,-13,-4,-14, 2,-8,0,-1,-2,6,0,4, -3,9,12,9,14,10,3,2, -6,3,13,19,7,10,-3,-9, -12,-3,8,10,13,3,-7,-15, -14,-18,-7,-1,4,-9,-15,-27, -23,-9,-23,-5,-9,-16,-5,-17],
  [13,10,18,15,12,12,8,5, 11,13,13,11,-3,3,8,3, 7,7,7,5,4,-3,-5,-3, 4,3,13,1,2,1,-1,2, 3,5,8,4,-5,-6,-8,-11, -4,0,-5,-1,-7,-12,-8,-16, -6,-6,0,2,-9,-9,-11,-3, -9,2,3,-1,-5,-13,4,-20],
  [-9,22,22,27,27,19,10,20, -17,20,32,41,58,25,30,0, -20,6,9,49,47,35,19,9, 3,22,24,45,57,40,57,36, -18,28,19,47,31,34,39,23, -16,-27,15,6,9,17,10,5, -22,-23,-30,-16,-16,-23,-36,-32, -33,-28,-22,-43,-5,-32,-20,-41],
  [-74,-35,-18,-18,-11,15,4,-17, -12,17,14,17,17,38,23,11, 10,17,23,15,20,45,44,13, -8,22,24,27,26,33,26,3, -18,-4,21,24,27,23,9,-11, -19,-3,11,21,23,16,7,-9, -27,-11,4,13,14,4,-5,-17, -53,-34,-21,-11,-28,-14,-24,-43],
];
// pre-baked per piece-code (type|colour) × 0x88 square
const PST_MG = new Int16Array(16 * 128), PST_EG = new Int16Array(16 * 128);
for (let t = 1; t <= 6; t++) for (const sq of ALL_SQUARES) {
  const r = sq >> 4, f = sq & 7;
  const wi = (7 - r) * 8 + f, bi = r * 8 + f;
  PST_MG[(t | WHITE) * 128 + sq] = MG_VAL[t] + MG[t][wi];
  PST_EG[(t | WHITE) * 128 + sq] = EG_VAL[t] + EG[t][wi];
  PST_MG[(t | BLACK) * 128 + sq] = MG_VAL[t] + MG[t][bi];
  PST_EG[(t | BLACK) * 128 + sq] = EG_VAL[t] + EG[t][bi];
}

// static score from the side to move's point of view (centipawns)
export function evaluate(s) {
  const b = s.board;
  let mgW = 0, mgB = 0, egW = 0, egB = 0, phase = 0, bW = 0, bB = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = b[sq];
    if (!p) continue;
    const i = p * 128 + sq;
    if (p & 8) { mgB += PST_MG[i]; egB += PST_EG[i]; if ((p & 7) === BISHOP) bB++; }
    else { mgW += PST_MG[i]; egW += PST_EG[i]; if ((p & 7) === BISHOP) bW++; }
    phase += PHASE[p & 7];
  }
  if (bW >= 2) { mgW += 30; egW += 50; }
  if (bB >= 2) { mgB += 30; egB += 50; }
  const mp = Math.min(phase, 24);
  const score = (((mgW - mgB) * mp + (egW - egB) * (24 - mp)) / 24) | 0;
  return (s.side === WHITE ? score : -score) + 12;   // small tempo bonus
}

export function material(s, side) {
  let v = 0;
  for (const sq of ALL_SQUARES) { const p = s.board[sq]; if (p && (p & 8) === side && (p & 7) !== KING) v += VALUE[p & 7]; }
  return v;
}

// ---------------------------------------------------------------- search
const TT_BITS = 20, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
const ttLock = new Uint32Array(TT_SIZE), ttMove = new Int32Array(TT_SIZE), ttScore = new Int16Array(TT_SIZE);
const ttDepth = new Int8Array(TT_SIZE), ttFlag = new Uint8Array(TT_SIZE);
const EXACT = 1, LOWER = 2, UPPER = 3;
const MAX_PLY = 64;
const killers = new Int32Array(MAX_PLY * 2);
const histTable = new Int32Array(16 * 128);
const moveBufs = Array.from({ length: MAX_PLY + 8 }, () => new Int32Array(256));
const scoreBufs = Array.from({ length: MAX_PLY + 8 }, () => new Int32Array(256));

export function clearTT() { ttLock.fill(0); ttMove.fill(0); ttDepth.fill(0); ttFlag.fill(0); }

class Timeout extends Error {}

function scoreMoves(s, moves, scores, n, ply, ttm) {
  const b = s.board;
  for (let i = 0; i < n; i++) {
    const m = moves[i];
    if (m === ttm) { scores[i] = 1 << 30; continue; }
    const t = (m >> 7) & 127, cap = b[t], promo = (m >> 14) & 7;
    if (cap || ((m >> 17) & 3) === FL_EP) scores[i] = (1 << 24) + VALUE[cap & 7 || PAWN] * 16 - VALUE[b[m & 127] & 7] / 10;
    else if (promo) scores[i] = (1 << 23) + VALUE[promo];
    else if (m === killers[ply * 2]) scores[i] = 1 << 22;
    else if (m === killers[ply * 2 + 1]) scores[i] = (1 << 22) - 1;
    else scores[i] = histTable[b[m & 127] * 128 + t];
  }
}
function pickNext(moves, scores, n, i) {
  let best = i;
  for (let j = i + 1; j < n; j++) if (scores[j] > scores[best]) best = j;
  if (best !== i) {
    const m = moves[i]; moves[i] = moves[best]; moves[best] = m;
    const sc = scores[i]; scores[i] = scores[best]; scores[best] = sc;
  }
  return moves[i];
}

function hasPieces(s, side) {
  for (const sq of ALL_SQUARES) { const p = s.board[sq]; if (p && (p & 8) === side && (p & 7) !== PAWN && (p & 7) !== KING) return true; }
  return false;
}

export function createSearch() {
  let nodes = 0, deadline = 0, stopFlag = false;

  function quiesce(s, alpha, beta, ply) {
    if ((++nodes & 2047) === 0 && Date.now() > deadline) throw new Timeout();
    const stand = evaluate(s);
    if (ply >= MAX_PLY) return stand;
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    const moves = moveBufs[ply], scores = scoreBufs[ply];
    const n = genPseudo(s, moves, true);
    scoreMoves(s, moves, scores, n, ply, 0);
    const side = s.side;
    for (let i = 0; i < n; i++) {
      const m = pickNext(moves, scores, n, i);
      // delta pruning: even winning this piece can't lift us to alpha
      const cap = s.board[(m >> 7) & 127];
      if (!((m >> 14) & 7) && stand + VALUE[cap & 7 || PAWN] + 200 < alpha) continue;
      makeMove(s, m);
      if (attacked(s, s.kings[side >> 3], s.side)) { unmakeMove(s); continue; }
      const sc = -quiesce(s, -beta, -alpha, ply + 1);
      unmakeMove(s);
      if (sc >= beta) return sc;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  }

  function search(s, depth, alpha, beta, ply, allowNull) {
    if ((++nodes & 2047) === 0 && Date.now() > deadline) throw new Timeout();
    if (ply && (s.half >= 100 || repetitions(s) >= 2)) return 0;
    const check = inCheck(s);
    if (check) depth++;
    if (depth <= 0) return quiesce(s, alpha, beta, ply);
    if (ply >= MAX_PLY) return evaluate(s);
    const alpha0 = alpha;
    // item effects make the position differ from what the hash says: skip the table while they are live
    const effects = (s.shield && s.ply < s.shield.until) || (s.frozen && s.ply < s.frozen.until);
    const idx = s.lo & TT_MASK;
    let ttm = 0;
    if (!effects && ttLock[idx] === s.hi) {
      ttm = ttMove[idx];
      if (ply && ttDepth[idx] >= depth) {
        let sc = ttScore[idx];
        if (sc > MATE - 200) sc -= ply; else if (sc < -MATE + 200) sc += ply;
        const fl = ttFlag[idx];
        if (fl === EXACT || (fl === LOWER && sc >= beta) || (fl === UPPER && sc <= alpha)) return sc;
      }
    }
    const pv = beta - alpha > 1;
    // null-move pruning
    if (allowNull && !pv && !check && depth >= 3 && !effects && hasPieces(s, s.side) && evaluate(s) >= beta) {
      makeNull(s);
      const sc = -search(s, depth - 3, -beta, -beta + 1, ply + 1, false);
      unmakeNull(s);
      if (sc >= beta) return beta;
    }
    const moves = moveBufs[ply], scores = scoreBufs[ply];
    let n = genPseudo(s, moves, false);
    scoreMoves(s, moves, scores, n, ply, ttm);
    const side = s.side;
    let best = -MATE * 2, bestMove = 0, legal = 0;
    for (let i = 0; i < n; i++) {
      const m = pickNext(moves, scores, n, i);
      makeMove(s, m);
      if (attacked(s, s.kings[side >> 3], s.side)) { unmakeMove(s); continue; }
      legal++;
      const quiet = !u_lastCap(s) && !((m >> 14) & 7);
      let sc;
      if (legal === 1) sc = -search(s, depth - 1, -beta, -alpha, ply + 1, true);
      else {
        // late move reduction for quiet moves far down the list
        let r = 0;
        if (depth >= 3 && legal > 4 && quiet && !check && !inCheck(s)) r = legal > 10 ? 2 : 1;
        sc = -search(s, depth - 1 - r, -alpha - 1, -alpha, ply + 1, true);
        if (sc > alpha && (r || sc < beta)) sc = -search(s, depth - 1, -beta, -alpha, ply + 1, true);
      }
      unmakeMove(s);
      if (sc > best) { best = sc; bestMove = m; }
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) {
        if (quiet) {
          if (killers[ply * 2] !== m) { killers[ply * 2 + 1] = killers[ply * 2]; killers[ply * 2] = m; }
          histTable[s.board[m & 127] * 128 + ((m >> 7) & 127)] += depth * depth;
        }
        break;
      }
    }
    if (!legal) {
      // frozen piece was the only way out: the ice melts
      if (s.frozen && s.ply < s.frozen.until) {
        const saved = s.frozen; s.frozen = null;
        const sc = search(s, depth, alpha0, beta, ply, false);
        s.frozen = saved;
        return sc;
      }
      return check ? -MATE + ply : 0;
    }
    if (!effects) {
      let st = best;
      if (st > MATE - 200) st += ply; else if (st < -MATE + 200) st -= ply;
      ttLock[idx] = s.hi; ttMove[idx] = bestMove; ttScore[idx] = st; ttDepth[idx] = depth;
      ttFlag[idx] = best <= alpha0 ? UPPER : best >= beta ? LOWER : EXACT;
    }
    return best;
  }
  const u_lastCap = s => s.u.cap[s.u.cap.length - 1];

  // Iterative deepening. Returns { move, score, depth, nodes }. `bonus(m)` adds root-only extras (item boxes).
  function think(s, { maxDepth = 64, timeMs = 1000, bonus = null } = {}) {
    nodes = 0; deadline = Date.now() + timeMs; stopFlag = false;
    killers.fill(0); histTable.fill(0);
    const root = legalMoves(s);
    if (!root.length) return { move: 0, score: inCheck(s) ? -MATE : 0, depth: 0, nodes };
    let bestMove = root[0], bestScore = -MATE * 2, done = 0;
    const order = root.slice();
    const rootScores = new Map();
    for (let d = 1; d <= maxDepth; d++) {
      try {
        let alpha = -MATE * 2, beta = MATE * 2, iterBest = 0, iterScore = -MATE * 2;
        for (let i = 0; i < order.length; i++) {
          const m = order[i];
          const extra = bonus ? bonus(m) : 0;
          makeMove(s, m);
          let sc;
          if (i === 0) sc = -search(s, d - 1, -beta, -alpha + extra, 1, true) + extra;
          else {
            sc = -search(s, d - 1, -alpha + extra - 1, -alpha + extra, 1, true) + extra;
            if (sc > alpha) sc = -search(s, d - 1, -beta, -alpha + extra, 1, true) + extra;
          }
          unmakeMove(s);
          rootScores.set(m, sc);
          if (sc > iterScore) { iterScore = sc; iterBest = m; }
          if (sc > alpha) alpha = sc;
        }
        bestMove = iterBest; bestScore = iterScore; done = d;
        // best first next time, the rest by last score
        order.sort((a, b) => (b === bestMove) - (a === bestMove) || (rootScores.get(b) ?? -1e9) - (rootScores.get(a) ?? -1e9));
        if (Math.abs(bestScore) > MATE - 100) break;
        if (Date.now() > deadline - timeMs * 0.45 && d >= 2) break;   // next iteration would not finish
      } catch (e) {
        if (!(e instanceof Timeout)) throw e;
        // undo whatever the aborted iteration left made
        while (s.u.move.length > 0 && s.ply > rootPly) { if (s.u.move[s.u.move.length - 1] === 0) unmakeNull(s); else unmakeMove(s); }
        break;
      }
    }
    return { move: bestMove, score: bestScore, depth: done, nodes };
  }
  let rootPly = 0;
  // exact score of every root move at a fixed depth (for the friendlier levels, which pick among good moves)
  function scoreAll(s, depth, timeMs = 3000, bonus = null) {
    nodes = 0; deadline = Date.now() + timeMs;
    killers.fill(0); histTable.fill(0);
    rootPly = s.ply;
    const out = [];
    for (const m of legalMoves(s)) {
      const extra = bonus ? bonus(m) : 0;
      makeMove(s, m);
      let sc;
      try { sc = -search(s, depth - 1, -MATE * 2, MATE * 2, 1, true) + extra; }
      catch (e) {
        if (!(e instanceof Timeout)) throw e;
        while (s.ply > rootPly + 1) { if (s.u.move[s.u.move.length - 1] === 0) unmakeNull(s); else unmakeMove(s); }
        sc = -evaluate(s) + extra;
        deadline = Date.now() + 200;
      }
      unmakeMove(s);
      out.push({ move: m, score: sc });
    }
    return out.sort((a, b) => b.score - a.score);
  }
  return {
    think(s, opts) { rootPly = s.ply; return think(s, opts); },
    scoreAll,
    get nodes() { return nodes; },
  };
}
