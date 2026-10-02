// Renderer, post-processing (bloom), reflections from the arena sky, camera + orbit controls, picking, shake.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildArena, makeSky, CONFIG } from './arenas.js?v=1';
import { Board } from './board.js?v=1';
import { FX } from './fx.js?v=1';
import { updateTweens, tween, ease, lerp } from './util.js?v=1';

export class Stage {
  constructor(canvas, overlay, quality = 'high') {
    this.canvas = canvas; this.quality = quality;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 800);
    this.camera.position.set(0, 11, 12);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, enablePan: false, minDistance: 8, maxDistance: 24, minPolarAngle: 0.25, maxPolarAngle: 1.28, rotateSpeed: 0.7, zoomSpeed: 0.8 });
    this.controls.target.set(0, 0, 0.2);
    this.pmrem = new THREE.PMREMGenerator(r);
    this.fx = new FX(this.scene, this.camera, overlay);
    this.board = new Board(this.scene, this.fx, this);
    this.clock = new THREE.Clock();
    this.t = 0; this.shakeAmt = 0; this.auto = 0;
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2();
    this.setQuality(quality);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setQuality(q) {
    this.quality = q;
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : 1.25));
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q === 'high' ? 4 : 0 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.4, 0.5, 0.9);
    this.bloom.enabled = q === 'high';
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    if (this.arena) this.applyArenaLook();
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    if (!w || !h) return;      // hidden tab / zero-size window: keep the last good size
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    // portrait phones: step back so the whole board fits
    this.camera.fov = w / h < 0.8 ? 52 : 38;
    this.camera.updateProjectionMatrix();
  }

  async setArena(id) {
    if (this.arena) { this.scene.remove(this.arena.group); disposeTree(this.arena.group); }
    this.arena = buildArena(id, this.quality);
    this.scene.add(this.arena.group);
    this.board.build(id, CONFIG[id]);
    this.applyArenaLook();
  }
  applyArenaLook() {
    const cfg = this.arena.cfg;
    this.scene.fog = new THREE.Fog(cfg.fog[0], cfg.fog[1], cfg.fog[2]);
    this.renderer.toneMappingExposure = cfg.exposure;
    this.bloom.strength = cfg.bloom[0]; this.bloom.radius = cfg.bloom[1]; this.bloom.threshold = cfg.bloom[2];
    // glossy toys reflect the arena's own sky + a big soft "studio" light from above
    const env = new THREE.Scene();
    const sky = makeSky(cfg); sky.scale.setScalar(0.15); env.add(sky);
    const box = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2), side: THREE.DoubleSide }));
    box.position.set(5, 30, 10); box.lookAt(0, 0, 0); env.add(box);
    const side = new THREE.Mesh(new THREE.PlaneGeometry(25, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(cfg.trim).multiplyScalar(1.6), side: THREE.DoubleSide }));
    side.position.set(-30, 6, -10); side.lookAt(0, 0, 0); env.add(side);
    this.scene.environment?.dispose();
    this.scene.environment = this.pmrem.fromScene(env, 0.035).texture;
    this.scene.environmentIntensity = cfg.envBoost;
  }

  // camera home for the side at the bottom of the screen; animated sweep if `sweep`
  view(side, { sweep = false, dur = 1.6 } = {}) {
    const zs = side === 'dark' ? -1 : 1;
    const portrait = this.camera.aspect < 0.8;
    const dist = portrait ? 14.5 : 11.6, h = portrait ? 14 : 9.8;
    const end = new THREE.Vector3(0, h, dist * zs);
    this.board.setFlip(side === 'dark');
    if (!sweep) { this.camera.position.copy(end); this.controls.target.set(0, 0, 0.3 * zs); this.controls.update(); return Promise.resolve(); }
    const start = this.camera.position.clone();
    const a0 = Math.atan2(start.x, start.z), a1 = Math.atan2(end.x, end.z);
    let da = a1 - a0; da = Math.atan2(Math.sin(da), Math.cos(da));
    if (Math.abs(da) < 0.3 && sweep === 'intro') da += Math.PI * 2 * Math.sign(zs);
    const r0 = Math.hypot(start.x, start.z), r1 = Math.hypot(end.x, end.z);
    this.controls.enabled = false;
    return tween(dur, k => {
      const a = a0 + da * k, r = lerp(r0, r1, k);
      this.camera.position.set(Math.sin(a) * r, lerp(start.y, end.y, k) + Math.sin(Math.PI * k) * 2, Math.cos(a) * r);
      this.controls.target.set(0, 0, 0.3 * zs * k);
      this.camera.lookAt(this.controls.target);
    }, ease.inOut).then(() => { this.controls.enabled = true; this.controls.update(); });
  }

  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }

  pick(x, y) {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const meshes = [];
    for (const p of this.board.pieces.values()) p.root.traverse(o => { if (o.isMesh && o.visible) meshes.push(o); });
    const hitP = this.ray.intersectObjects(meshes, false)[0];
    if (hitP) { const p = hitP.object.userData.piece; if (p && p.sq >= 0) return p.sq; }
    const hitT = this.ray.intersectObjects(this.board.tiles || [], false)[0];
    if (hitT) {
      const which = this.board.tiles.indexOf(hitT.object);
      return this.board.tileSq[which][hitT.instanceId];
    }
    // the item boxes hover over empty squares
    for (const [sq, b] of this.board.boxes) if (this.ray.intersectObject(b, true).length) return sq;
    return -1;
  }

  frame(update) {
    if (this.canvas.clientWidth !== this._w || this.canvas.clientHeight !== this._h) { this._w = this.canvas.clientWidth; this._h = this.canvas.clientHeight; this.resize(); }
    // animations follow real time even on a slow frame rate; the ambient motion just steps less smoothly
    const real = Math.min(0.25, this.clock.getDelta()), dt = Math.min(0.05, real);
    this.t += dt;
    updateTweens(real);
    update?.(dt, this.t);
    if (this.auto) { const a = this.auto * dt; const p = this.camera.position; const x = p.x, z = p.z; p.x = x * Math.cos(a) - z * Math.sin(a); p.z = x * Math.sin(a) + z * Math.cos(a); }
    if (this.controls.enabled) this.controls.update();
    this.arena?.update(this.t, dt);
    this.board.update(this.t, dt, this.camera.position);
    this.fx.update(dt);
    let off = null;
    if (this.shakeAmt > 0.001) {
      off = new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(this.shakeAmt);
      this.camera.position.add(off);
      this.shakeAmt *= Math.pow(0.0005, dt);
    }
    if (this.bloom.enabled) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    if (off) this.camera.position.sub(off);
  }
}

function disposeTree(root) {
  root.traverse(o => {
    if (o.isMesh || o.isPoints) {
      // library geometry is shared with other clones; only throw away what the arena built itself
      if (!o.geometry.userData.keep && !o.userData.lib) o.geometry?.dispose?.();
    }
  });
}
