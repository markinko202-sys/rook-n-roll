// Move-generator check against the standard perft counts (chessprogramming.org/Perft_Results)
import { fromFEN, perft, toFEN, createSearch, START_FEN } from '../js/chess.js';
const cases = [
  [START_FEN, [20, 400, 8902, 197281]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238, 674624]],
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467, 422333]],
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
  ['r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]],
];
let ok = true;
const t0 = Date.now();
for (const [fen, counts] of cases) {
  const s = fromFEN(fen);
  counts.forEach((want, i) => {
    const got = perft(s, i + 1);
    if (got !== want) { ok = false; console.log('FAIL', fen, 'depth', i + 1, 'got', got, 'want', want); }
  });
  if (toFEN(s) !== fen) { ok = false; console.log('FEN roundtrip/unmake mismatch', toFEN(s), fen); }
}
console.log(ok ? 'PERFT OK' : 'PERFT FAILED', (Date.now() - t0) + 'ms');
const s = fromFEN();
const se = createSearch();
for (const ms of [300, 1000, 2000]) {
  const r = se.think(s, { timeMs: ms });
  console.log(`think ${ms}ms → depth ${r.depth}, score ${r.score}, nodes ${r.nodes}, fen intact: ${toFEN(s) === START_FEN}`);
}
// mate in 2 sanity: should find it
const m2 = fromFEN('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
const r = se.think(m2, { timeMs: 1000 });
console.log('scholar mate position best score', r.score, 'move', r.move);
