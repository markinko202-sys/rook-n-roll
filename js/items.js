// Kart-style items. Every use is checked so the chess rules still hold afterwards:
// the enemy king is never left in check by an item, and the user always keeps a legal move.
import {
  WHITE, BLACK, PAWN, KING, QUEEN, ALL_SQUARES, clone, attacked, legalMoves, rehash, material, VALUE,
} from './chess.js?v=1';

export const ITEM_IDS = ['shield', 'freeze', 'bomb', 'warp', 'boost'];

// how many squares a target needs: 1 or 2 (warp swaps two of your own pieces)
export const ITEM_PICKS = { shield: 1, freeze: 1, bomb: 1, warp: 2, boost: 1 };

const CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[0] = 15 & ~2; CASTLE_MASK[7] = 15 & ~1; CASTLE_MASK[112] = 15 & ~8; CASTLE_MASK[119] = 15 & ~4;

const own = (s, sq, side) => s.board[sq] && (s.board[sq] & 8) === side;
const pieceType = (s, sq) => s.board[sq] & 7;

// raw candidate targets before the safety check
function candidates(s, side, id) {
  const them = side ^ 8, out = [];
  const sqs = ALL_SQUARES;
  if (id === 'shield') for (const a of sqs) { if (own(s, a, side) && pieceType(s, a) !== KING) out.push({ a }); }
  if (id === 'freeze') for (const a of sqs) { if (own(s, a, them) && pieceType(s, a) !== KING) out.push({ a }); }
  if (id === 'bomb') for (const a of sqs) { if (own(s, a, them) && pieceType(s, a) === PAWN) out.push({ a }); }
  if (id === 'boost') {
    const dir = side === WHITE ? 16 : -16;
    for (const a of sqs) if (own(s, a, side) && pieceType(s, a) === PAWN && !s.board[a + dir]) out.push({ a, b: a + dir });
  }
  if (id === 'warp') {
    const mine = sqs.filter(a => own(s, a, side) && pieceType(s, a) !== KING);
    for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) {
      const a = mine[i], b = mine[j];
      if (s.board[a] === s.board[b]) continue;                       // swapping twins changes nothing
      const backRank = sq => (sq >> 4) === 0 || (sq >> 4) === 7;
      if ((pieceType(s, a) === PAWN && backRank(b)) || (pieceType(s, b) === PAWN && backRank(a))) continue;
      out.push({ a, b });
    }
  }
  return out;
}

// change the position in place (no safety checks)
export function applyRaw(s, side, id, t, promo = QUEEN) {
  const fx = { id, a: t.a, b: t.b ?? -1, side };
  if (id === 'shield') s.shield = { sq: t.a, side, until: s.ply + 2 };
  else if (id === 'freeze') s.frozen = { sq: t.a, until: s.ply + 2 };
  else if (id === 'bomb') { fx.removed = s.board[t.a]; s.board[t.a] = 0; s.half = 0; }
  else if (id === 'warp') {
    const x = s.board[t.a]; s.board[t.a] = s.board[t.b]; s.board[t.b] = x;
    s.castle &= CASTLE_MASK[t.a] & CASTLE_MASK[t.b];
  } else if (id === 'boost') {
    const p = s.board[t.a];
    const last = (t.b >> 4) === (side === WHITE ? 7 : 0);
    s.board[t.b] = last ? (promo | side) : p; s.board[t.a] = 0; s.half = 0;
    if (last) fx.promo = promo;
  }
  // an en-passant chance disappears when its pawn is gone or moved
  if (s.ep >= 0) {
    const pawnSq = s.ep + (s.side === WHITE ? -16 : 16);
    if (s.board[pawnSq] !== (PAWN | (s.side ^ 8))) s.ep = -1;
  }
  rehash(s);
  s.hist[s.hist.length - 1] = s.lo;   // same turn, new picture
  return fx;
}

function safeAfter(s, side) {
  const them = side ^ 8;
  if (attacked(s, s.kings[them >> 3], side)) return false;   // no instant king hits
  return legalMoves(s).length > 0;                           // and the user still has a move
}

export function itemTargets(s, side, id) {
  if (s.side !== side) return [];
  return candidates(s, side, id).filter(t => {
    const c = clone(s);
    applyRaw(c, side, id, t);
    return safeAfter(c, side);
  });
}

export function canUse(s, side, id) { return itemTargets(s, side, id).length > 0; }

// Mario Kart rubber-banding: whoever is behind on material rolls stronger items
export function rollItem(s, side, rand = Math.random) {
  const diff = material(s, side ^ 8) - material(s, side);   // > 0: we are behind
  const w = { shield: 3, freeze: 3, bomb: 2, warp: 2, boost: 3 };
  if (diff >= 300) { w.bomb += 3; w.warp += 2; w.freeze += 1; }
  else if (diff >= 100) { w.bomb += 1; w.warp += 1; }
  else if (diff <= -300) { w.bomb = 1; w.shield += 2; }
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (const id of ITEM_IDS) { r -= w[id]; if (r < 0) return id; }
  return 'shield';
}

// item boxes: always in mirrored pairs (one per half of the board) on empty squares of ranks 3-6
export function spawnPair(s, boxes, rand = Math.random) {
  const options = [];
  for (let r = 2; r <= 3; r++) for (let f = 0; f < 8; f++) {
    const a = r * 16 + f, b = (7 - r) * 16 + f;
    if (!s.board[a] && !s.board[b] && !boxes.includes(a) && !boxes.includes(b)) options.push([a, b]);
  }
  if (!options.length) return null;
  return options[Math.floor(rand() * options.length)];
}

export const ITEM_VALUE_HINT = { shield: 60, freeze: 70, bomb: VALUE[PAWN], warp: 80, boost: 50 };
export { BLACK };
