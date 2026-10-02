// The CPU rival: picks an item to use (or not) and a move. Runs inside a Web Worker (ai-worker.js).
import { deserialize, clone, createSearch, legalMoves, to, MATE } from './chess.js?v=1';
import { ITEM_IDS, itemTargets, applyRaw } from './items.js?v=1';

const search = createSearch();

// Easy picks loosely among decent moves, Medium among near-best ones, Hard plays its best (1.4 s of search)
export const LEVELS = [
  { name: 'easy', depth: 2, temp: 110, itemMargin: 0, quick: 1 },
  { name: 'medium', depth: 3, temp: 28, itemMargin: 25, quick: 2 },
  { name: 'hard', time: 1400, temp: 0, itemMargin: 35, quick: 2 },
];

function pickSoft(list, temp, rand) {
  if (!temp || list.length === 1) return list[0];
  const best = list[0].score;
  const w = list.map(x => Math.exp(Math.max(-12, (x.score - best) / temp)));
  // never throw away a forced mate or walk into one when something else exists
  const total = w.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
  return list[0];
}

function chooseMove(s, level, boxes, holding, rand) {
  const L = LEVELS[level];
  const bonus = m => (!holding && boxes.includes(to(m))) ? 45 : 0;
  if (L.time) {
    const r = search.think(s, { timeMs: L.time, bonus });
    return { move: r.move, score: r.score, depth: r.depth };
  }
  const list = search.scoreAll(s, L.depth, 2500, bonus);
  if (!list.length) return { move: 0, score: -MATE, depth: 0 };
  // keep mates honest even at 50cc
  if (list[0].score > MATE - 100) return { move: list[0].move, score: list[0].score, depth: L.depth };
  const sane = list.filter(x => x.score > -MATE + 100);
  const pick = pickSoft(sane.length ? sane : list, L.temp, rand);
  return { move: pick.move, score: pick.score, depth: L.depth };
}

function quickScore(s, depth) {
  const r = search.think(s, { maxDepth: depth, timeMs: 120 });
  return r.score;
}

export function decide({ state, level = 1, boxes = [], held = null, itemsOn = true, seed = Math.random() }) {
  let x = (seed * 2 ** 31) | 0 || 1;
  const rand = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
  const s = deserialize(state);
  const side = s.side, L = LEVELS[level];
  let item = null, work = s;

  if (itemsOn && held) {
    const options = itemTargets(s, side, held);
    if (options.length) {
      const base = quickScore(clone(s), L.quick);
      let scored = options.map(t => {
        const c = clone(s); applyRaw(c, side, held, t);
        return { t, score: quickScore(c, L.quick) };
      }).sort((a, b) => b.score - a.score);
      // look a bit deeper at the best few before committing
      scored = scored.slice(0, 4).map(o => {
        const c = clone(s); applyRaw(c, side, held, o.t);
        return { t: o.t, score: quickScore(c, L.quick + 2) };
      }).sort((a, b) => b.score - a.score);
      const deeperBase = quickScore(clone(s), L.quick + 2);
      const gain = scored[0].score - Math.max(base, deeperBase);
      const use = level === 0 ? (gain > -20 && rand() < 0.75) : gain > L.itemMargin;
      if (use) {
        item = { id: held, ...scored[0].t };
        work = clone(s); applyRaw(work, side, held, scored[0].t);
      }
    }
  }
  const choice = chooseMove(work, level, boxes, !!held && !item, rand);
  if (!choice.move) {
    // the item path somehow ran out of moves: play without it
    item = null; work = s;
    Object.assign(choice, chooseMove(s, level, boxes, !!held, rand));
  }
  if (!legalMoves(work).includes(choice.move)) choice.move = legalMoves(work)[0];
  return { item, move: choice.move, score: choice.score, depth: choice.depth };
}

export { ITEM_IDS };
