// Module worker: thinking happens here so the 3D scene never stutters.
import { decide } from './ai.js?v=1';

self.onmessage = e => {
  const { id, job } = e.data;
  const t0 = performance.now();
  try {
    const r = decide(job);
    self.postMessage({ id, ok: true, result: r, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.stack || err) });
  }
};
