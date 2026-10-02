// AI + items smoke test: CPU vs CPU games with items on, checks that every item use and move stays legal
import { fromFEN, serialize, legalMoves, makeMove, status, inCheck, attacked, toFEN, sqName, from, to } from '../js/chess.js';
import { itemTargets, applyRaw, rollItem, spawnPair } from '../js/items.js';
import { decide } from '../js/ai.js';

const games = +(process.argv[2] || 3), levels = [0, 1, 1];
let itemUses = 0, pickups = 0;
for (let g = 0; g < games; g++) {
  const s = fromFEN();
  let boxes = spawnPair(s, []) || [], held = [null, null], spawnTimer = 0, plies = 0, result;
  const t0 = Date.now();
  while (plies < 160) {
    const st = status(s);
    if (st.over) { result = st.result + ' ' + st.reason; break; }
    const side = s.side, lv = side ? levels[g % 3] : 0;
    const r = decide({ state: serialize(s), level: lv, boxes, held: held[side >> 3], itemsOn: true, seed: Math.random() });
    if (r.item) {
      const ok = itemTargets(s, side, r.item.id).some(t => t.a === r.item.a && (t.b ?? -1) === (r.item.b ?? -1));
      if (!ok) throw new Error('illegal item ' + JSON.stringify(r.item));
      applyRaw(s, side, r.item.id, r.item); held[side >> 3] = null; itemUses++;
      if (attacked(s, s.kings[(side ^ 8) >> 3], side)) throw new Error('item left enemy in check');
    }
    if (!legalMoves(s).includes(r.move)) throw new Error('illegal move ' + r.move + ' ' + toFEN(s));
    makeMove(s, r.move);
    const t = to(r.move);
    if (boxes.includes(t)) { boxes = boxes.filter(b => b !== t); if (!held[side >> 3]) { held[side >> 3] = rollItem(s, side); pickups++; } }
    if (!boxes.length && ++spawnTimer >= 6) { const p = spawnPair(s, boxes); if (p) { boxes.push(...p); spawnTimer = 0; } }
    plies++;
  }
  console.log(`game ${g + 1}: ${result || 'unfinished'} after ${plies} plies, ${((Date.now() - t0) / Math.max(plies, 1)).toFixed(0)} ms/ply`);
}
console.log(`items used ${itemUses}, boxes picked ${pickups}`);
