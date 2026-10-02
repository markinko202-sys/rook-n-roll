// One match: chess position + item boxes + held items + history (for undo) + the move log.
// Pure logic, no Three.js; the scene animates the events this returns.
import * as C from './chess.js?v=1';
import * as I from './items.js?v=1';

export class Game {
  constructor({ itemsOn = true, rand = Math.random } = {}) {
    this.s = C.fromFEN();
    this.itemsOn = itemsOn;
    this.rand = rand;
    this.boxes = [];
    this.held = [null, null];
    this.spawnTimer = 0;
    this.itemUsed = false;          // one item per turn
    this.log = [];                  // { side, san, item }
    this.lost = [[], []];           // pieces each side has lost (piece codes), for the benches
    this.stats = { items: [0, 0], captures: [0, 0], boxes: [0, 0] };
    this.history = [];
    this.result = null;
    if (itemsOn) { const p = I.spawnPair(this.s, [], rand); if (p) this.boxes.push(...p); }
  }

  get side() { return this.s.side; }
  idx(side = this.s.side) { return side >> 3; }

  snapshot() {
    return JSON.stringify({
      s: C.serialize(this.s), boxes: this.boxes, held: this.held, spawnTimer: this.spawnTimer, itemUsed: this.itemUsed,
      log: this.log, lost: this.lost, stats: this.stats, result: this.result,
    });
  }
  restore(json) {
    const o = JSON.parse(json);
    this.s = C.deserialize(o.s);
    Object.assign(this, { boxes: o.boxes, held: o.held, spawnTimer: o.spawnTimer, itemUsed: o.itemUsed, log: o.log, lost: o.lost, stats: o.stats, result: o.result });
  }
  // remember the position at the start of a human turn so Undo can return to it
  markTurn() { this.history.push(this.snapshot()); if (this.history.length > 120) this.history.shift(); }

  legal() { return C.legalMoves(this.s); }
  legalFrom(sq) { return this.legal().filter(m => C.from(m) === sq); }
  frozenSq() { const f = this.s.frozen; return f && this.s.ply < f.until && C.freezeHolds(this.s) ? f.sq : -1; }
  shieldInfo() { const sh = this.s.shield; return sh && this.s.ply < sh.until ? sh : null; }

  move(m) {
    const s = this.s, side = s.side;
    const f = C.from(m), t = C.to(m), flag = C.flagOf(m), promo = C.promoOf(m);
    const piece = s.board[f];
    const san = C.san(s, m);
    let capSq = -1, captured = 0;
    if (flag === 2) { capSq = t + (side === C.WHITE ? -16 : 16); captured = s.board[capSq]; }
    else if (s.board[t]) { capSq = t; captured = s.board[t]; }
    let rook = null;
    if (flag === 3) rook = t === 6 ? [7, 5] : t === 2 ? [0, 3] : t === 118 ? [119, 117] : [112, 115];
    C.makeMove(s, m);
    if (captured) { this.lost[(captured & 8) >> 3].push(captured); this.stats.captures[side >> 3]++; }
    const ev = { type: 'move', m, side, from: f, to: t, piece, captured, capSq, rook, promo, san, pickup: null, popped: false, spawned: null };
    this.afterLanding(ev, t, side);
    this.itemUsed = false;
    this.log.push({ side, san });
    ev.status = this.checkEnd();
    return ev;
  }

  afterLanding(ev, t, side) {
    if (!this.itemsOn) return;
    const bi = this.boxes.indexOf(t);
    if (bi >= 0) {
      this.boxes.splice(bi, 1);
      ev.popped = true;
      this.stats.boxes[side >> 3]++;
      if (!this.held[side >> 3]) { this.held[side >> 3] = I.rollItem(this.s, side, this.rand); ev.pickup = this.held[side >> 3]; }
    }
    if (ev.type === 'move') {
      if (this.boxes.length < 2 && ++this.spawnTimer >= 5) {
        const p = I.spawnPair(this.s, this.boxes, this.rand);
        if (p) { this.boxes.push(...p); ev.spawned = p; }
        this.spawnTimer = 0;
      }
    }
  }

  itemTargets(side = this.s.side) {
    const id = this.held[side >> 3];
    if (!id || this.itemUsed || this.result) return [];
    return I.itemTargets(this.s, side, id);
  }

  useItem(target, promo = C.QUEEN) {
    const side = this.s.side, id = this.held[side >> 3];
    const before = this.s.board.slice();
    const fx = I.applyRaw(this.s, side, id, target, promo);
    fx.piece = before[target.a]; fx.pieceB = target.b >= 0 ? before[target.b] : 0;
    this.held[side >> 3] = null;
    this.itemUsed = true;
    this.stats.items[side >> 3]++;
    if (id === 'bomb') this.lost[(fx.removed & 8) >> 3].push(fx.removed);
    const tag = { shield: '🛡', freeze: '❄', bomb: '💣', warp: '🌀', boost: '⚡' }[id];
    this.log.push({ side, san: tag + C.sqName(target.a) + (id === 'warp' ? '↔' + C.sqName(target.b) : ''), item: id });
    if (id === 'boost') { const ev = { type: 'item', pickup: null, popped: false }; this.afterLanding(ev, target.b, side); fx.pickup = ev.pickup; fx.popped = ev.popped; }
    fx.status = this.checkEnd(true);
    return fx;
  }

  checkEnd(afterItem = false) {
    if (afterItem) {
      if (C.insufficient(this.s)) return (this.result = { over: true, result: '1/2', reason: 'material' });
      return { over: false, check: C.inCheck(this.s) };
    }
    const st = C.status(this.s);
    if (st.over) this.result = st;
    return st;
  }

  material(side) { return C.material(this.s, side); }
}
