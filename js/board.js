// The chessboard, the characters standing on it, highlights, item boxes and every on-board animation
// (hops, knight flips, capture "bonks", castling, promotion, the five item effects).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { make, find, findAll } from './assets.js?v=1';
import { paintTeam, itemBoxMaterial, styleItemBox } from './arenas.js?v=1';
import { tween, ease, rand, sleep, lerp } from './util.js?v=1';
import { fileOf, rankOf, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK } from './chess.js?v=1';
import * as audio from './audio.js?v=1';

export const TYPE_NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
export const sqPos = (sq, y = 0) => new THREE.Vector3(fileOf(sq) - 3.5, y, 3.5 - rankOf(sq));
const BENCH_Y = -0.53;
const VOICE = [0, 1.5, 1.15, 1.0, 0.85, 1.3, 0.75];

class Piece {
  constructor(code, arena, sq) {
    this.code = code; this.type = code & 7; this.team = code & 8 ? 'dark' : 'light';
    this.arena = arena; this.sq = sq;
    this.root = new THREE.Group();
    this.root.userData.piece = this;
    this.setModel();
    this.root.position.copy(sqPos(sq));
    this.ph = rand(0, 10); this.yaw = 0; this.yawTarget = null; this.busy = false;
    this.squash = 1; this.frozen = null; this.bubble = null; this.dizzy = 0; this.cheer = 0; this.knocked = false;
  }
  setModel() {
    if (this.model) this.root.remove(this.model);
    this.model = paintTeam(make(`${this.arena}_${TYPE_NAMES[this.type]}`), this.arena, this.team);
    this.root.add(this.model);
    this.body = find(this.model, 'body') || this.model;
    this.wings = [find(this.model, 'wingL'), find(this.model, 'wingR')].filter(Boolean);
    this.model.traverse(o => { if (o.isMesh) o.userData.piece = this; });
  }
  update(t, dt, camPos) {
    // turn to face the camera (or wherever we were told to look)
    let target = this.yawTarget;
    if (target === null) {
      const dx = camPos.x - this.root.position.x, dz = camPos.z - this.root.position.z;
      target = Math.atan2(dx, dz);
    }
    let d = target - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 6);
    this.root.rotation.y = this.yaw;
    if (this.frozen) { this.body.scale.set(1, 1, 1); return; }
    // idle: breathing squash, ghosts float, wings flap
    const breath = Math.sin(t * 2.2 + this.ph) * 0.025;
    const s = this.squash;
    let hop = 0;
    if (this.cheer > 0) { this.cheer -= dt; hop = Math.abs(Math.sin((t + this.ph) * 7)) * 0.35; }
    this.body.scale.set(1 / Math.sqrt(s) - breath * 0.5, s + breath, 1 / Math.sqrt(s) - breath * 0.5);
    this.body.position.y = 0.1 + hop + ((this.arena === 'spooky' && this.type === PAWN) ? 0.05 + Math.sin(t * 2 + this.ph) * 0.04 : 0);
    this.body.rotation.z = this.knocked ? 0 : Math.sin(t * 1.3 + this.ph) * 0.02;
    for (const [i, w] of this.wings.entries()) w.rotation.x = Math.sin(t * (this.cheer > 0 ? 18 : 5) + this.ph) * 0.35 * (i ? -1 : 1);
    if (this.bubble) { const k = 1 + Math.sin(t * 5) * 0.04; this.bubble.scale.set(k, 2 - k, k); this.bubble.rotation.y = t; }
  }
}

export class Board {
  constructor(scene, fx, stage) {
    this.scene = scene; this.fx = fx; this.stage = stage;
    this.group = new THREE.Group(); scene.add(this.group);
    this.pieces = new Map();          // sq → Piece
    this.bench = [[], []];            // lost pieces by side index
    this.boxes = new Map();           // sq → mesh
    this.hl = new THREE.Group(); this.group.add(this.hl);
    this.flip = false;
  }

  // ------------------------------------------------------------ board geometry
  build(arenaId, cfg) {
    this.arena = arenaId; this.cfg = cfg;
    for (const c of [...this.group.children]) if (c !== this.hl) { this.group.remove(c); }
    const tileGeo = new RoundedBoxGeometry(0.97, 0.24, 0.97, 3, 0.05);
    const mk = (hex) => new THREE.MeshPhysicalMaterial({ color: hex, roughness: cfg.tiles.rough, clearcoat: 1, clearcoatRoughness: 0.08, emissive: hex, emissiveIntensity: cfg.tiles.glow });
    this.tiles = [new THREE.InstancedMesh(tileGeo, mk(cfg.tiles.light), 32), new THREE.InstancedMesh(tileGeo, mk(cfg.tiles.dark), 32)];
    this.tileSq = [[], []];
    const m = new THREE.Matrix4(); const cnt = [0, 0];
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const dark = (r + f) % 2 === 0 ? 1 : 0;
      const sq = r * 16 + f, p = sqPos(sq, -0.12);
      m.makeTranslation(p.x, p.y, p.z);
      this.tiles[dark].setMatrixAt(cnt[dark], m); this.tileSq[dark][cnt[dark]++] = sq;
    }
    for (const t of this.tiles) { t.receiveShadow = true; t.castShadow = false; this.group.add(t); }
    const frame = new THREE.Mesh(new RoundedBoxGeometry(9.3, 0.5, 9.3, 4, 0.2), new THREE.MeshPhysicalMaterial({ color: cfg.frame, roughness: 0.35, clearcoat: 1 }));
    frame.position.y = -0.33; frame.receiveShadow = true; frame.castShadow = true; this.group.add(frame);
    const grout = new THREE.Mesh(new RoundedBoxGeometry(8.24, 0.12, 8.24, 2, 0.05), new THREE.MeshPhysicalMaterial({ color: cfg.trim, roughness: 0.3, clearcoat: 1, emissive: cfg.trim, emissiveIntensity: this.arena === 'candy' ? 0 : 0.5 }));
    grout.position.y = -0.1; this.group.add(grout);
    this.labels = new THREE.Mesh(new THREE.PlaneGeometry(9.3, 9.3), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
    this.labels.rotation.x = -Math.PI / 2; this.labels.position.y = -0.07; this.group.add(this.labels);
    this.drawLabels();
    this.makeHighlightKit();
  }

  drawLabels() {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const g = c.getContext('2d'), k = 1024 / 9.3;
    g.font = '800 46px Nunito, "Arial Rounded MT Bold", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = this.cfg.label;
    const put = (txt, x, z) => {
      g.save(); g.translate((x + 4.65) * k, (z + 4.65) * k); if (this.flip) g.rotate(Math.PI); g.fillText(txt, 0, 0); g.restore();
    };
    for (let i = 0; i < 8; i++) {
      put('abcdefgh'[i], i - 3.5, 4.33); put('abcdefgh'[i], i - 3.5, -4.33);
      put(String(i + 1), -4.33, 3.5 - i); put(String(i + 1), 4.33, 3.5 - i);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    this.labels.material.map?.dispose(); this.labels.material.map = t; this.labels.material.needsUpdate = true;
  }
  setFlip(f) { if (this.flip !== f) { this.flip = f; this.drawLabels(); } }

  makeHighlightKit() {
    for (const c of [...this.hl.children]) this.hl.remove(c);
    const H = this.cfg.hl;
    const basic = (hex, op = 0.9) => new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: op, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.kit = {
      dot: { geo: new THREE.CircleGeometry(0.17, 32), mat: basic(H.move, 0.9) },
      cap: { geo: new THREE.RingGeometry(0.36, 0.47, 48), mat: basic(H.capture, 0.95) },
      sel: { geo: new THREE.RingGeometry(0.4, 0.48, 48), mat: basic(H.select, 0.95) },
      last: { geo: new THREE.PlaneGeometry(0.94, 0.94), mat: basic(H.last, 0.55) },
      item: { geo: new THREE.RingGeometry(0.3, 0.46, 48), mat: basic(H.item, 0.95) },
      itemfill: { geo: new THREE.PlaneGeometry(0.94, 0.94), mat: basic(H.item, 0.28) },
      hint: { geo: new THREE.PlaneGeometry(0.94, 0.94), mat: basic('#5be38a', 0.45) },
      hover: { geo: new THREE.PlaneGeometry(0.94, 0.94), mat: basic('#ffffff', 0.16) },
      check: { geo: new THREE.CircleGeometry(0.48, 48), mat: new THREE.MeshBasicMaterial({ map: radialTex('#ff2e4d'), transparent: true, depthWrite: false, toneMapped: false }) },
    };
    this.marks = {};
  }
  // show(kind, squares): replaces that kind's markers
  show(kind, squares = []) {
    const list = (this.marks[kind] ||= []);
    while (list.length > squares.length) this.hl.remove(list.pop());
    while (list.length < squares.length) {
      const k = this.kit[kind], m = new THREE.Mesh(k.geo, k.mat);
      m.rotation.x = -Math.PI / 2; m.renderOrder = 2; this.hl.add(m); list.push(m);
    }
    squares.forEach((sq, i) => { list[i].position.copy(sqPos(sq, kind === 'last' || kind === 'hover' ? 0.006 : 0.012)); list[i].userData.sq = sq; });
  }
  clearMarks(...kinds) { for (const k of kinds.length ? kinds : Object.keys(this.marks)) this.show(k, []); }

  // ------------------------------------------------------------ pieces
  setPosition(board, lost) {
    for (const p of this.pieces.values()) this.group.remove(p.root);
    for (const side of this.bench) for (const p of side) this.group.remove(p.root);
    this.pieces.clear(); this.bench = [[], []];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      if (board[sq]) this.addPiece(board[sq], sq);
    }
    lost?.forEach((codes, si) => codes.forEach(code => {
      const p = new Piece(code, this.arena, 0); this.group.add(p.root); this.toBench(p, true);
    }));
  }
  addPiece(code, sq) {
    const p = new Piece(code, this.arena, sq);
    this.pieces.set(sq, p); this.group.add(p.root);
    return p;
  }
  benchSlot(sideIdx, i) {
    // White's losses line up on the right of the board (from White's seat), Black's on the left
    const col = Math.floor(i / 8), row = i % 8;
    const x = (sideIdx === 0 ? 5.2 : -5.2) + (sideIdx === 0 ? col : -col) * 0.6;
    return new THREE.Vector3(x, BENCH_Y, (sideIdx === 0 ? -3.4 : 3.4) + (sideIdx === 0 ? row : -row) * 0.92);
  }
  toBench(p, instant = false) {
    const si = p.team === 'light' ? 0 : 1;
    const pos = this.benchSlot(si, this.bench[si].length);
    this.bench[si].push(p);
    p.sq = -1;
    if (instant) { p.root.position.copy(pos); p.root.scale.setScalar(0.62); }
    return pos;
  }

  update(t, dt, camPos) {
    for (const p of this.pieces.values()) p.update(t, dt, camPos);
    for (const side of this.bench) for (const p of side) p.update(t, dt, camPos);
    for (const [sq, b] of this.boxes) { b.rotation.y = t * 1.4 + sq; b.rotation.x = 0.25; b.position.y = 0.42 + Math.sin(t * 2.4 + sq) * 0.06; }
    this.boxMat?.userData.update(t);
    const pulse = 0.85 + Math.sin(t * 6) * 0.15;
    if (this.kit) {
      this.kit.dot.mat.opacity = 0.75 + 0.2 * Math.sin(t * 5);
      this.kit.item.mat.opacity = pulse; this.kit.cap.mat.opacity = pulse;
      for (const m of this.marks.check || []) m.scale.setScalar(1 + Math.sin(t * 8) * 0.12);
      for (const m of this.marks.item || []) m.scale.setScalar(0.92 + Math.sin(t * 6) * 0.08);
    }
  }

  // ------------------------------------------------------------ item boxes on the board
  setBoxes(list, animate = true) {
    this.boxMat ||= itemBoxMaterial();
    for (const [sq, b] of [...this.boxes]) if (!list.includes(sq)) { this.group.remove(b); this.boxes.delete(sq); }
    for (const sq of list) {
      if (this.boxes.has(sq)) continue;
      const b = make('item_box'); styleItemBox(b, this.boxMat);
      b.position.copy(sqPos(sq, 0.42)); this.group.add(b); this.boxes.set(sq, b);
      if (animate) { audio.sfx('spawn'); tween(0.6, k => b.scale.setScalar(Math.max(0.001, k) * 0.86), ease.elastic); }
      else b.scale.setScalar(0.86);
    }
  }
  popBox(sq) {
    const b = this.boxes.get(sq);
    if (!b) return;
    this.boxes.delete(sq); this.group.remove(b);
    this.fx.burst('shard', sqPos(sq, 0.5), { count: 26, speed: 3.2, up: 4, colors: ['#ff6fb5', '#ffd23f', '#5be38a', '#4db5ff', '#b07cff', '#ffffff'], life: 1.0, size: 1.4 });
    this.fx.burst('spark', sqPos(sq, 0.5), { count: 16, speed: 2, up: 2, colors: ['#ffffff'], life: 0.6 });
    audio.sfx('box');
  }

  // ------------------------------------------------------------ animation helpers
  async squash(p, amount = 0.75, dur = 0.09) { await tween(dur, k => { p.squash = lerp(1, amount, k); }, ease.out); }
  async unsquash(p) { await tween(0.35, k => { p.squash = lerp(p.squash, 1, k); }, ease.elastic); p.squash = 1; }

  async hop(p, to, { height = 0.45, dur = 0.2, spin = 0, sound = true } = {}) {
    const from = p.root.position.clone();
    const dir = new THREE.Vector3().subVectors(to, from);
    if (dir.lengthSq() > 1e-4) p.yawTarget = Math.atan2(dir.x, dir.z);
    if (sound) audio.sfx('hop', VOICE[p.type]);
    await tween(dur, k => {
      p.root.position.lerpVectors(from, to, k);
      p.root.position.y = lerp(from.y, to.y, k) + Math.sin(Math.PI * k) * height;
      p.squash = 1 + Math.sin(Math.PI * k) * 0.12;
      if (spin) p.body.rotation.y = spin * k;
    }, ease.inOut);
    if (spin) p.body.rotation.y = 0;
    p.squash = 0.82;
    this.fx.burst('puff', to.clone().setY(to.y + 0.05), { count: 4, speed: 0.9, up: 0.4, colors: ['#ffffff'], life: 0.45, size: 0.7, gravity: 0, drag: 0.9 });
  }

  async walk(p, fromSq, toSq, finalCb) {
    const df = fileOf(toSq) - fileOf(fromSq), dr = rankOf(toSq) - rankOf(fromSq);
    if (p.type === KNIGHT) {
      await this.squash(p, 0.7, 0.1);
      const dur = 0.55;
      const hopP = this.hop(p, sqPos(toSq), { height: 1.5, dur, spin: Math.PI * 2 });
      if (finalCb) setTimeout(finalCb, dur * 700);
      await hopP;
    } else {
      const steps = Math.max(Math.abs(df), Math.abs(dr));
      const stride = steps > 5 ? 2 : 1;
      const sf = Math.sign(df), sr = Math.sign(dr);
      let cur = fromSq;
      await this.squash(p, 0.82, 0.07);
      for (let i = stride; i <= steps + stride - 1; i += stride) {
        const k = Math.min(i, steps);
        const next = (rankOf(fromSq) + sr * k) * 16 + fileOf(fromSq) + sf * k;
        const last = k === steps;
        const hp = this.hop(p, sqPos(next), { height: last ? 0.5 : 0.32, dur: last ? 0.24 : 0.16 });
        if (last && finalCb) setTimeout(finalCb, 140);
        await hp;
        cur = next;
      }
    }
    this.unsquash(p);
    p.yawTarget = null;
  }

  // a captured piece gets bonked off the board onto its team's bench
  async launch(victim, fromPos, word = 'POW!') {
    const pos = victim.root.position.clone();
    this.fx.burst('star', pos.clone().setY(0.7), { count: 14, speed: 3.5, up: 4, colors: ['#ffd23f', '#ffffff', '#ff6fb5'], life: 1.1 });
    this.fx.ring(pos, { color: '#ffffff', to: 1.6 });
    this.fx.word(word, pos.clone().setY(1.6), 'bonk');
    this.stage.shake(0.18);
    audio.sfx('bonk');
    const target = this.toBench(victim);
    const start = victim.root.position.clone();
    const away = fromPos ? new THREE.Vector3().subVectors(start, fromPos).setY(0).normalize() : new THREE.Vector3(0, 0, 0);
    victim.knocked = true; victim.yawTarget = null;
    const peak = 3.2 + rand(0, 0.8);
    await tween(0.95, k => {
      const p = new THREE.Vector3().lerpVectors(start, target, k).addScaledVector(away, Math.sin(Math.PI * k) * 1.2);
      p.y = lerp(start.y, target.y, k) + Math.sin(Math.PI * k) * peak;
      victim.root.position.copy(p);
      victim.root.rotation.z = k * Math.PI * 4;
      victim.root.scale.setScalar(lerp(1, 0.62, k));
    }, ease.linear);
    victim.root.rotation.z = 0; victim.knocked = false;
    victim.squash = 0.6; this.unsquash(victim);
    this.fx.burst('puff', target.clone().setY(target.y + 0.1), { count: 5, speed: 1, up: 0.5, colors: ['#ffffff'], life: 0.5, size: 0.6, gravity: 0 });
    audio.sfx('land');
  }

  // ------------------------------------------------------------ playing a move event from Game.move()
  async playMove(ev) {
    const p = this.pieces.get(ev.from);
    if (!p) { this.syncTo(ev); return; }
    this.pieces.delete(ev.from);
    const victim = ev.captured ? this.pieces.get(ev.capSq) : null;
    if (victim) this.pieces.delete(ev.capSq);
    let launched = null;
    const onContact = victim ? () => { launched = this.launch(victim, p.root.position.clone(), ev.capSq !== ev.to ? 'BONK!' : (Math.random() < 0.5 ? 'POW!' : 'BONK!')); } : null;
    const tasks = [this.walk(p, ev.from, ev.to, onContact)];
    if (ev.rook) {
      const r = this.pieces.get(ev.rook[0]);
      if (r) {
        this.pieces.delete(ev.rook[0]);
        tasks.push(sleep(180).then(() => this.walk(r, ev.rook[0], ev.rook[1])));
        this.pieces.set(ev.rook[1], r); r.sq = ev.rook[1];
      }
    }
    await Promise.all(tasks);
    if (victim && !launched) launched = this.launch(victim, p.root.position.clone());
    if (launched) await launched;
    p.sq = ev.to; this.pieces.set(ev.to, p);
    if (ev.popped) this.popBox(ev.to);
    if (ev.promo) await this.promote(p, ev.promo);
  }

  async promote(p, type) {
    audio.sfx('promote');
    this.fx.burst('spark', p.root.position.clone().setY(0.6), { count: 40, speed: 2.5, up: 4, colors: ['#ffd23f', '#ffffff', '#ff6fb5', '#4de1ff'], life: 1.2 });
    await tween(0.35, k => { p.body.rotation.y = k * Math.PI * 4; p.root.scale.setScalar(1 - k * 0.9); }, ease.in);
    p.type = type; p.code = type | (p.team === 'dark' ? BLACK : WHITE);
    p.setModel();
    await tween(0.5, k => { p.root.scale.setScalar(0.1 + k * 0.9); }, ease.elastic);
    p.root.scale.setScalar(1);
    this.fx.word('★', p.root.position.clone().setY(1.6), 'star');
  }

  // make the 3D board match the position (after undo / loading); no animation
  syncTo(game) {
    if (game?.s) {
      this.setPosition(game.s.board, game.lost);
      this.setBoxes(game.boxes, false);
      this.refreshEffects(game);
    }
  }

  // ------------------------------------------------------------ item effects
  refreshEffects(game) {
    const sh = game.shieldInfo(), fz = game.frozenSq();
    for (const p of this.pieces.values()) {
      this.setBubble(p, !!sh && sh.sq === p.sq);
      this.setIce(p, fz === p.sq);
    }
  }
  setBubble(p, on) {
    if (on && !p.bubble) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.6, 40, 24), new THREE.MeshPhysicalMaterial({ color: '#bfefff', roughness: 0.05, iridescence: 1, iridescenceIOR: 1.6, transparent: true, opacity: 0.32, depthWrite: false, clearcoat: 1 }));
      m.position.y = 0.55; p.root.add(m); p.bubble = m;
      tween(0.4, k => m.scale.setScalar(Math.max(0.01, k)), ease.elastic);
    } else if (!on && p.bubble) {
      const m = p.bubble; p.bubble = null;
      this.fx.burst('spark', p.root.position.clone().setY(0.6), { count: 18, speed: 2.4, up: 1, colors: ['#bfefff', '#ffffff'], life: 0.5 });
      audio.sfx('pop');
      p.root.remove(m);
    }
  }
  setIce(p, on) {
    if (on && !p.frozen) {
      const m = new THREE.Mesh(new RoundedBoxGeometry(0.82, 1.15, 0.82, 3, 0.08), new THREE.MeshPhysicalMaterial({ color: '#c9f6ff', roughness: 0.05, transparent: true, opacity: 0.45, clearcoat: 1, depthWrite: false, emissive: '#7fe6ff', emissiveIntensity: 0.25 }));
      m.position.y = 0.6; p.root.add(m); p.frozen = m;
      tween(0.35, k => m.scale.set(1, Math.max(0.01, k), 1), ease.back);
    } else if (!on && p.frozen) {
      const m = p.frozen; p.frozen = null;
      this.fx.burst('shard', p.root.position.clone().setY(0.6), { count: 16, speed: 2, up: 2, colors: ['#c9f6ff', '#ffffff'], life: 0.7 });
      audio.sfx('melt');
      tween(0.3, k => m.scale.set(1, 1 - k * 0.99, 1), ease.in).then(() => p.root.remove(m));
    }
  }

  // fx from Game.useItem(); `from` is where thrown things start (the user's side of the board)
  async playItem(fx, game, fromZ) {
    const a = this.pieces.get(fx.a);
    if (fx.id === 'shield') {
      audio.sfx('shield');
      this.fx.burst('spark', sqPos(fx.a, 0.6), { count: 24, speed: 2, up: 2, colors: ['#bfefff', '#ffffff', '#8fe3ff'], life: 0.8 });
      if (a) { this.setBubble(a, true); a.cheer = 0.6; }
      await sleep(450);
    } else if (fx.id === 'freeze') {
      audio.sfx('freeze');
      await this.beam(fromZ, sqPos(fx.a, 0.6), '#9fefff');
      this.fx.burst('shard', sqPos(fx.a, 0.8), { count: 22, speed: 2.4, up: 3, colors: ['#c9f6ff', '#ffffff', '#7fe6ff'], life: 0.9 });
      if (a) this.setIce(a, true);
      await sleep(350);
    } else if (fx.id === 'bomb') {
      const bomb = make('bomb'); bomb.scale.setScalar(1.3);
      const start = new THREE.Vector3(0, 1.5, fromZ), end = sqPos(fx.a, 0.15);
      this.group.add(bomb); audio.sfx('throw');
      await tween(0.7, k => { bomb.position.lerpVectors(start, end, k); bomb.position.y = lerp(start.y, end.y, k) + Math.sin(Math.PI * k) * 3; bomb.rotation.z = k * 6; }, ease.linear);
      audio.sfx('fuse');
      await tween(0.6, k => { const s = 1.3 + Math.abs(Math.sin(k * Math.PI * 5)) * 0.25; bomb.scale.setScalar(s); });
      this.group.remove(bomb);
      audio.sfx('boom');
      this.fx.burst('puff', end.clone().setY(0.4), { count: 26, speed: 3.5, up: 2.5, colors: ['#ffffff', '#ffe066', '#ff9f43', '#5b4b7a'], life: 1.0, size: 2.2, gravity: -0.5, drag: 0.9, grow: 1.5 });
      this.fx.burst('spark', end.clone().setY(0.4), { count: 30, speed: 5, up: 4, colors: ['#ffd23f', '#ff6f3d'], life: 0.7 });
      this.fx.ring(end, { color: '#ffb15c', to: 3.2, dur: 0.7 });
      this.fx.word('BOOM!', end.clone().setY(1.7), 'boom');
      this.stage.shake(0.45);
      if (a) { this.pieces.delete(fx.a); await this.launch(a, end.clone().add(new THREE.Vector3(0, 0, fromZ > 0 ? 1 : -1)), ''); }
    } else if (fx.id === 'warp') {
      const b = this.pieces.get(fx.b);
      audio.sfx('warp');
      const portals = [fx.a, fx.b].map(sq => this.portal(sqPos(sq, 0.02)));
      await sleep(250);
      await tween(0.45, k => { for (const p of [a, b]) if (p) { p.root.scale.set(1 - k * 0.95, 1 - k * 0.95, 1 - k * 0.95); p.body.rotation.y = k * 10; p.root.position.y = -k * 0.3; } }, ease.in);
      if (a && b) {
        this.pieces.set(fx.a, b); this.pieces.set(fx.b, a);
        const pa = a.root.position.clone(), pb = b.root.position.clone();
        a.root.position.copy(pb); b.root.position.copy(pa); a.sq = fx.b; b.sq = fx.a;
      }
      await tween(0.5, k => { for (const p of [a, b]) if (p) { p.root.scale.setScalar(0.05 + k * 0.95); p.body.rotation.y = (1 - k) * 10; p.root.position.y = -(1 - k) * 0.3; } }, ease.back);
      for (const p of [a, b]) if (p) { p.root.scale.setScalar(1); p.body.rotation.y = 0; p.root.position.y = 0; }
      await Promise.all(portals.map(pt => pt.close()));
    } else if (fx.id === 'boost') {
      audio.sfx('zap');
      await this.bolt(sqPos(fx.a));
      if (a) {
        this.pieces.delete(fx.a);
        this.fx.burst('puff', sqPos(fx.a, 0.1), { count: 10, speed: 1.6, up: 0.5, colors: ['#ffffff', '#ffe066'], life: 0.5, size: 0.8, gravity: 0 });
        audio.sfx('dash');
        await this.hop(a, sqPos(fx.b), { height: 0.7, dur: 0.3, sound: false });
        a.sq = fx.b; this.pieces.set(fx.b, a); this.unsquash(a); a.yawTarget = null;
        if (fx.popped) this.popBox(fx.b);
        if (fx.promo) await this.promote(a, fx.promo);
      }
    }
  }

  beam(fromZ, to, color) {
    const start = new THREE.Vector3(0, 1.8, fromZ);
    const g = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 2), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    this.group.add(g);
    return tween(0.45, k => { g.position.lerpVectors(start, to, k); g.position.y += Math.sin(Math.PI * k) * 1.2; this.fx.burst('spark', g.position, { count: 1, speed: 0.3, up: 0.2, colors: [color], life: 0.4, gravity: 0 }); }, ease.inOut)
      .then(() => this.group.remove(g));
  }
  portal(pos) {
    const tex = spiralTex();
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.48, 48), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2; m.position.copy(pos); m.position.y = 0.015; this.group.add(m);
    let alive = true;
    const spin = () => { if (!alive) return; m.rotation.z += 0.12; requestAnimationFrame(spin); };
    spin();
    tween(0.3, k => m.scale.setScalar(Math.max(0.01, k)), ease.back);
    return { close: () => tween(0.3, k => m.scale.setScalar(1 - k * 0.99), ease.in).then(() => { alive = false; this.group.remove(m); }) };
  }
  async bolt(pos) {
    const b = make('icon_boost'); b.scale.setScalar(1.6); b.position.set(pos.x, 6, pos.z);
    b.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.toneMapped = false; } });
    this.group.add(b);
    await tween(0.25, k => { b.position.y = lerp(6, 0.6, k); }, ease.in);
    this.fx.burst('spark', pos.clone().setY(0.5), { count: 24, speed: 3, up: 3, colors: ['#ffe066', '#ffffff'], life: 0.6 });
    this.fx.ring(pos, { color: '#ffe066', to: 1.8 });
    this.stage.shake(0.12);
    await tween(0.2, k => b.scale.setScalar(1.6 * (1 - k)), ease.in);
    this.group.remove(b);
  }

  // ------------------------------------------------------------ celebrations
  async checkmate(kingSq, winnerTeam) {
    const k = this.pieces.get(kingSq);
    if (k) {
      k.yawTarget = k.yaw;
      audio.sfx('mate');
      await tween(0.8, t => { k.root.rotation.z = t * Math.PI / 2 * 0.9; k.root.position.y = Math.sin(Math.PI * t) * 0.5; }, ease.out);
      this.fx.burst('star', k.root.position.clone().setY(0.8), { count: 20, speed: 2, up: 3, colors: ['#ffd23f', '#ffffff'], life: 1.4 });
    }
    this.celebrate(winnerTeam);
  }
  celebrate(team) {
    let i = 0;
    for (const p of this.pieces.values()) if (!team || p.team === team) { const d = i++ * 60; setTimeout(() => { p.cheer = 3.5; }, d); }
    for (let n = 0; n < 6; n++) setTimeout(() => this.fx.burst('confetti', new THREE.Vector3(rand(-4, 4), 6, rand(-4, 4)), { count: 40, speed: 2.5, up: 1, gravity: 2.5, drag: 0.94, colors: ['#ff6fb5', '#ffd23f', '#5be38a', '#4db5ff', '#b07cff', '#ffffff'], life: 3.2, spin: 1.5 }), n * 300);
  }
  shakeKing(sq) {
    const k = this.pieces.get(sq);
    if (!k) return;
    this.fx.word('!', k.root.position.clone().setY(1.7), 'alert');
    tween(0.5, t => { k.body.rotation.z = Math.sin(t * 40) * 0.12 * (1 - t); });
  }
  select(sq, on) {
    const p = this.pieces.get(sq);
    if (!p) return;
    if (on) { p.squash = 0.8; this.unsquash(p); audio.voice(VOICE[p.type]); tween(0.35, k => { p.body.position.y = 0.1 + Math.sin(Math.PI * k) * 0.25; }, ease.out); }
  }
}

function radialTex(hex) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  const col = new THREE.Color(hex); const rgb = `${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0}`;
  gr.addColorStop(0, `rgba(${rgb},0.95)`); gr.addColorStop(0.6, `rgba(${rgb},0.5)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
let _spiral = null;
function spiralTex() {
  if (_spiral) return _spiral;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.translate(128, 128);
  for (let i = 0; i < 400; i++) {
    const a = i * 0.09, r = i * 0.3;
    g.fillStyle = `hsla(${(i * 1.4 + 260) % 360}, 95%, 65%, ${1 - i / 420})`;
    g.beginPath(); g.arc(Math.cos(a) * r, Math.sin(a) * r, 6 + i * 0.02, 0, Math.PI * 2); g.fill();
  }
  _spiral = new THREE.CanvasTexture(c); _spiral.colorSpace = THREE.SRGBColorSpace;
  return _spiral;
}
