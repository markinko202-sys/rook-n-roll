// Small shared helpers: tweens that resolve as promises, easing, random.
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = {
  linear: t => t,
  inOut: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  out: t => 1 - Math.pow(1 - t, 3),
  in: t => t * t * t,
  back: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  elastic: t => t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1,
};
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const sleep = ms => new Promise(r => setTimeout(r, ms));

const tweens = new Set();
let speed = 1;
export function setAnimSpeed(s) { speed = s; }

// tween(duration seconds, t => {...}) → Promise. t runs 0..1 (already eased if `e` given).
export function tween(dur, fn, e = ease.linear) {
  return new Promise(resolve => {
    const tw = { t: 0, dur: Math.max(0.0001, dur), fn, e, resolve };
    tweens.add(tw);
    fn(e(0));
  });
}
export function updateTweens(dt) {
  for (const tw of [...tweens]) {
    tw.t += dt * speed;
    const k = Math.min(1, tw.t / tw.dur);
    tw.fn(tw.e(k));
    if (k >= 1) { tweens.delete(tw); tw.resolve(); }
  }
}
export function busyTweens() { return tweens.size; }
export function finishAllTweens() { for (const tw of [...tweens]) { tw.fn(tw.e(1)); tweens.delete(tw); tw.resolve(); } }
