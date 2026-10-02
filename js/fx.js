// Particles (instanced 3D stars, confetti, puffs, shards, sparks), shockwave rings and comic pop-up words.
import * as THREE from 'three';
import { tween, ease, rand } from './util.js?v=1';

const CAP = 360;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

function starGeometry(r = 0.1, inner = 0.045, depth = 0.04) {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? inner : r;
    i ? sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 });
  g.center();
  return g;
}

class Pool {
  constructor(scene, geo, mat) {
    this.mesh = new THREE.InstancedMesh(geo, mat, CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    const col = new Float32Array(CAP * 3).fill(1);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
    scene.add(this.mesh);
    this.p = Array.from({ length: CAP }, () => ({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, max: 1, size: 1, g: 9, drag: 0.98, grow: 0 }));
    this.next = 0;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < CAP; i++) this.mesh.setMatrixAt(i, _m);
  }
  spawn(o) {
    const i = this.next; this.next = (this.next + 1) % CAP;
    const p = this.p[i];
    Object.assign(p, { alive: true, life: o.life, max: o.life, size: o.size, g: o.g, drag: o.drag, grow: o.grow || 0 });
    p.pos.copy(o.pos); p.vel.copy(o.vel);
    p.rot.set(rand(0, 6), rand(0, 6), rand(0, 6)); p.spin.set(rand(-8, 8), rand(-8, 8), rand(-8, 8)).multiplyScalar(o.spin ?? 1);
    this.mesh.setColorAt(i, o.color);
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    let any = false;
    for (let i = 0; i < CAP; i++) {
      const p = this.p[i];
      if (!p.alive) continue;
      any = true;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); continue; }
      p.vel.y -= p.g * dt;
      p.vel.multiplyScalar(Math.pow(p.drag, dt * 60));
      p.pos.addScaledVector(p.vel, dt);
      p.rot.addScaledVector(p.spin, dt);
      const k = p.life / p.max;
      const sc = p.size * (p.grow ? (1 + p.grow * (1 - k)) * Math.min(1, k * 3) : Math.min(1, k * 2.5));
      _q.setFromEuler(_e.set(p.rot.x, p.rot.y, p.rot.z));
      _m.compose(p.pos, _q, _s.setScalar(sc));
      this.mesh.setMatrixAt(i, _m);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class FX {
  constructor(scene, camera, overlay) {
    this.scene = scene; this.camera = camera; this.overlay = overlay;
    const shiny = new THREE.MeshPhysicalMaterial({ roughness: 0.25, clearcoat: 1, metalness: 0.1 });
    const glowy = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.pools = {
      star: new Pool(scene, starGeometry(), shiny),
      confetti: new Pool(scene, new THREE.BoxGeometry(0.09, 0.015, 0.14), new THREE.MeshStandardMaterial({ roughness: 0.4, side: THREE.DoubleSide })),
      puff: new Pool(scene, new THREE.IcosahedronGeometry(0.12, 2), new THREE.MeshStandardMaterial({ roughness: 0.9 })),
      shard: new Pool(scene, new THREE.TetrahedronGeometry(0.08), new THREE.MeshPhysicalMaterial({ roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.85 })),
      spark: new Pool(scene, new THREE.IcosahedronGeometry(0.04, 1), glowy),
    };
    this.rings = [];
  }

  burst(kind, pos, o = {}) {
    const pool = this.pools[kind];
    const n = o.count ?? 20, colors = (o.colors || ['#ffffff']).map(c => new THREE.Color(c));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (o.speed ?? 3) * rand(0.4, 1);
      const up = o.up ?? 3;
      const vel = new THREE.Vector3(Math.cos(a) * sp, rand(0.4, 1) * up, Math.sin(a) * sp);
      pool.spawn({
        pos: _v.copy(pos).add(new THREE.Vector3(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).multiplyScalar(o.spread ?? 0.15)).clone(),
        vel, color: colors[i % colors.length], life: (o.life ?? 1.1) * rand(0.7, 1.2), size: (o.size ?? 1) * rand(0.7, 1.2),
        g: o.gravity ?? 7, drag: o.drag ?? 0.96, grow: o.grow, spin: o.spin,
      });
    }
  }

  ring(pos, { color = '#ffffff', from = 0.2, to = 2.2, dur = 0.6, y = 0.03, thick = 0.12 } = {}) {
    const m = new THREE.Mesh(new THREE.RingGeometry(1 - thick, 1, 64), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.copy(pos); m.position.y += y;
    this.scene.add(m);
    return tween(dur, t => { m.scale.setScalar(from + (to - from) * t); m.material.opacity = 1 - t; }, ease.out).then(() => { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); });
  }

  // comic word ("POW!", "CHECK!") floating above a 3D point
  word(text, pos, cls = '') {
    const v = pos.clone().project(this.camera);
    const el = document.createElement('div');
    el.className = 'pop-word ' + cls;
    el.textContent = text;
    el.style.left = ((v.x + 1) / 2 * 100) + '%';
    el.style.top = ((1 - v.y) / 2 * 100) + '%';
    this.overlay.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  update(dt) { for (const p of Object.values(this.pools)) p.update(dt); }
}
