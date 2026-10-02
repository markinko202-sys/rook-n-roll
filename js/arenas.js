// The three locations: sky, light, plinth under the board, the kart track around it, the dressing and the ambient life
// (karts, bats, UFO, balloons…). The board itself lives in board.js and takes its colours from CONFIG.
import * as THREE from 'three';
import { make, lib, palettes, find, findAll } from './assets.js?v=1';
import { rand } from './util.js?v=1';

export const ARENA_IDS = ['candy', 'spooky', 'galaxy'];

export const CONFIG = {
  candy: {
    sky: { top: '#8ccbff', mid: '#ffd3ea', bottom: '#fff1dc', stars: 0, nebula: 0 },
    fog: ['#ffe0f0', 34, 95],
    tiles: { light: '#FFF1DA', dark: '#FF9DCB', rough: 0.32, glow: 0 },
    frame: '#FFFFFF', trim: '#FF7EB8', label: '#FF5FA8',
    hemi: ['#fff3fa', '#ffbfdc', 0.6], sun: ['#fff1e2', 1.9, [7, 15, 9]],
    exposure: 0.95, bloom: [0.25, 0.4, 1.5], envBoost: 0.55,
    road: { base: '#ffe6f2', a: '#ff6fb5', b: '#ffffff', line: '#ffffff', glow: 0 },
    hl: { move: '#8a4dff', capture: '#ff2e5b', last: '#ffc21a', select: '#8a4dff', item: '#00b8d9' },
    music: 'candy',
  },
  spooky: {
    sky: { top: '#0e0a24', mid: '#3a2466', bottom: '#120c22', stars: 0.6, nebula: 0.25, neb1: '#6b3fd6', neb2: '#1f8a6b' },
    fog: ['#24183f', 26, 80],
    tiles: { light: '#7B68B0', dark: '#3A2C5E', rough: 0.55, glow: 0.04 },
    frame: '#2C2245', trim: '#FF8A1F', label: '#FFB15C',
    hemi: ['#8a78ff', '#1a1030', 0.75], sun: ['#c9c2ff', 1.8, [-8, 14, -7]],
    exposure: 1.0, bloom: [0.7, 0.5, 1.0], envBoost: 0.6,
    road: { base: '#4a3d6b', a: '#2c2245', b: '#5e4f86', line: '#ffb15c', glow: 0.25 },
    hl: { move: '#7fe0b5', capture: '#ff5a3d', last: '#ffb15c', select: '#e6fff4', item: '#c47bff' },
    music: 'spooky',
  },
  galaxy: {
    sky: { top: '#05061a', mid: '#1a1250', bottom: '#05061a', stars: 1, nebula: 1, neb1: '#7a2cff', neb2: '#ff3fa8' },
    fog: ['#0b0a2a', 40, 140],
    tiles: { light: '#A9B8FF', dark: '#3B2A8A', rough: 0.18, glow: 0.04 },
    frame: '#1E1A4A', trim: '#4DE1FF', label: '#9FF0FF',
    hemi: ['#a99cff', '#160a3a', 0.6], sun: ['#ffffff', 1.6, [6, 13, 8]],
    exposure: 0.95, bloom: [0.6, 0.5, 1.3], envBoost: 0.55,
    road: { rainbow: true, glow: 0.55 },
    hl: { move: '#4de1ff', capture: '#ff4fd8', last: '#ffd23f', select: '#ffffff', item: '#b14cff' },
    music: 'galaxy',
  },
};

// ---------------------------------------------------------------- sky dome (also feeds the reflections)
const SKY_VS = `varying vec3 vDir; void main(){ vDir = normalize((modelMatrix * vec4(position,0.0)).xyz); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`;
const SKY_FS = `
uniform vec3 top, mid, bottom, neb1, neb2; uniform float stars, nebula, time;
varying vec3 vDir;
float hash(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*vnoise(p); p*=2.03; a*=0.5; } return v; }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(mid, top, pow(clamp(h,0.0,1.0), 0.55)) : mix(mid, bottom, pow(clamp(-h,0.0,1.0), 0.45));
  if (nebula > 0.0) {
    float n1 = fbm(d*2.6 + vec3(0.0, time*0.004, 0.0)), n2 = fbm(d*4.2 + vec3(5.2,1.3,0.0));
    col += neb1 * smoothstep(0.48, 0.85, n1) * 0.55 * nebula;
    col += neb2 * smoothstep(0.55, 0.9, n2) * 0.45 * nebula;
  }
  if (stars > 0.0) {
    vec3 p = d * 260.0; float s = hash(floor(p));
    float tw = 0.55 + 0.45 * sin(time * 2.2 + s * 60.0);
    col += smoothstep(0.9965, 1.0, s) * tw * stars * 2.2 * smoothstep(-0.2, 0.25, h);
  }
  gl_FragColor = vec4(col, 1.0);
}`;
export function makeSky(cfg) {
  const u = {
    top: { value: new THREE.Color(cfg.sky.top) }, mid: { value: new THREE.Color(cfg.sky.mid) }, bottom: { value: new THREE.Color(cfg.sky.bottom) },
    neb1: { value: new THREE.Color(cfg.sky.neb1 || '#000') }, neb2: { value: new THREE.Color(cfg.sky.neb2 || '#000') },
    stars: { value: cfg.sky.stars }, nebula: { value: cfg.sky.nebula }, time: { value: 0 },
  };
  const m = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), new THREE.ShaderMaterial({ uniforms: u, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false }));
  m.frustumCulled = false; m.renderOrder = -10;
  return m;
}

// ---------------------------------------------------------------- textures
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat);
  t.anisotropy = 8;
  return t;
}
function roadTexture(r) {
  return canvasTex(256, 256, (g, w, h) => {
    if (r.rainbow) {
      const cols = ['#ff4f6d', '#ff9f43', '#ffe066', '#5be38a', '#4db5ff', '#a77bff'];
      cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, i * h / 6, w, h / 6 + 1); });
      g.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < 6; i++) g.fillRect(0, i * h / 6, w, 3);
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
      return;
    }
    g.fillStyle = r.base; g.fillRect(0, 0, w, h);
    // curbs on both edges
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? r.a : r.b;
      g.fillRect(i * w / 8, 0, w / 8, h * 0.12); g.fillRect(i * w / 8, h * 0.88, w / 8, h * 0.12);
    }
    g.fillStyle = r.line;
    g.fillRect(0, h * 0.48, w * 0.45, h * 0.04);
    // speckle
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`; g.fillRect(Math.random() * w, h * 0.12 + Math.random() * h * 0.76, 3, 3); }
  });
}

// road band: top surface with UVs along the track + skirts; height follows wave(θ)
function makeRoad(rIn, rOut, y, segs, wave, mat, sideMat, thick = 0.25) {
  const pos = [], uv = [], idx = [];
  const reps = 14;
  for (let i = 0; i <= segs; i++) {
    const a = i / segs * Math.PI * 2, yy = y + wave(a);
    const c = Math.cos(a), s = Math.sin(a);
    pos.push(c * rIn, yy, s * rIn, c * rOut, yy, s * rOut);
    uv.push(i / segs * reps, 0, i / segs * reps, 1);
  }
  for (let i = 0; i < segs; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const top = new THREE.Mesh(g, mat); top.receiveShadow = true;
  const grp = new THREE.Group(); grp.add(top);
  for (const r of [rIn, rOut]) {
    const sp = [], si = [];
    for (let i = 0; i <= segs; i++) {
      const a = i / segs * Math.PI * 2, yy = y + wave(a);
      sp.push(Math.cos(a) * r, yy, Math.sin(a) * r, Math.cos(a) * r, yy - thick, Math.sin(a) * r);
    }
    for (let i = 0; i < segs; i++) { const k = i * 2; si.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setIndex(si); sg.computeVertexNormals();
    const m = new THREE.Mesh(sg, sideMat); m.material.side = THREE.DoubleSide; grp.add(m);
  }
  return grp;
}

// ---------------------------------------------------------------- team paint for figures
const teamCache = new Map();
export function paintTeam(root, arena, team) {
  const pal = palettes[arena][team];
  root.traverse(o => {
    if (!o.isMesh || !o.material.name?.startsWith('T_')) return;
    const key = arena + team + o.material.name;
    if (!teamCache.has(key)) {
      const m = o.material.clone();
      const slot = o.material.name.replace(/(_\d+|\d{3})+$/, '');
      const hex = pal[slot] || pal.T_main;
      m.color.set(hex);
      if (m.emissive && (slot === 'T_glow' || slot === 'T_ring')) { m.emissive.set(hex); m.emissiveIntensity = slot === 'T_glow' ? 0.55 : 0.45; }
      teamCache.set(key, m);
    }
    o.material = teamCache.get(key);
  });
  for (const b of findAll(root, 'brows')) b.visible = team === 'dark';
  return root;
}

// ---------------------------------------------------------------- arena builder
const place = (r, aDeg) => { const a = aDeg * Math.PI / 180; return [Math.sin(a) * r, -Math.cos(a) * r]; };

export function buildArena(id, quality) {
  const cfg = CONFIG[id];
  const group = new THREE.Group(); group.name = 'arena-' + id;
  const sky = makeSky(cfg); group.add(sky);
  const movers = [];            // { obj, update(t, dt) }
  const add = (name, x, y, z, s = 1, ry = 0, shadow = true) => {
    const o = make(name); o.position.set(x, y, z); o.scale.setScalar(s); o.rotation.y = ry;
    o.traverse(m => { if (m.isMesh) { m.castShadow = shadow && m.castShadow; } });
    group.add(o); return o;
  };
  const addPolar = (name, r, a, y = 0, s = 1, shadow = true) => { const [x, z] = place(r, a); return add(name, x, y, z, s, rand(0, Math.PI * 2), shadow); };

  // lights
  const hemi = new THREE.HemisphereLight(cfg.hemi[0], cfg.hemi[1], cfg.hemi[2]); group.add(hemi);
  const sun = new THREE.DirectionalLight(cfg.sun[0], cfg.sun[1]);
  sun.position.set(...cfg.sun[2]); sun.castShadow = true;
  const sm = quality === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(sm, sm);
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 50 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;
  group.add(sun); group.add(sun.target);

  const R_IN = 7.7, R_OUT = 9.5, R_MID = (R_IN + R_OUT) / 2;
  let roadY = -0.62, wave = () => 0;
  const roadTex = roadTexture(cfg.road);
  const roadMat = new THREE.MeshPhysicalMaterial({ map: roadTex, roughness: 0.45, clearcoat: 0.6, emissive: cfg.road.glow ? '#ffffff' : '#000000', emissiveMap: cfg.road.glow ? roadTex : null, emissiveIntensity: cfg.road.glow || 0, side: THREE.DoubleSide });
  let sideMat = new THREE.MeshStandardMaterial({ color: cfg.trim, roughness: 0.5 });

  if (id === 'candy') {
    // the board sits on a giant strawberry cake floating above a sea of clouds
    const cake = new THREE.Mesh(new THREE.CylinderGeometry(7.1, 7.1, 1.6, 96), new THREE.MeshPhysicalMaterial({ color: '#FFF4E8', roughness: 0.5, clearcoat: 0.3 }));
    cake.position.y = -1.33; cake.receiveShadow = true; group.add(cake);
    const frost = new THREE.Mesh(new THREE.CylinderGeometry(7.16, 7.16, 0.32, 96, 1, true), new THREE.MeshPhysicalMaterial({ color: '#FF8CC6', roughness: 0.25, clearcoat: 1 }));
    frost.position.y = -0.69; frost.receiveShadow = true; group.add(frost);
    const dripGeo = new THREE.CapsuleGeometry(0.16, 0.5, 4, 10), dripMat = frost.material;
    for (let i = 0; i < 44; i++) {
      const a = i / 44 * Math.PI * 2, L = 0.3 + ((i * 7) % 5) * 0.12;
      const d = new THREE.Mesh(dripGeo, dripMat); d.scale.set(1, L / 0.5 + 0.4, 1);
      d.position.set(Math.cos(a) * 7.12, -0.85 - L * 0.4, Math.sin(a) * 7.12); group.add(d);
    }
    const rim = new THREE.Mesh(new THREE.TorusGeometry(7.05, 0.2, 12, 120), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.4, clearcoat: 0.6 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = -0.53; group.add(rim);
    for (let i = 0; i < 30; i++) {   // cherries on the rim
      const a = i / 30 * Math.PI * 2;
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 12), new THREE.MeshPhysicalMaterial({ color: '#ff2e5b', roughness: 0.1, clearcoat: 1 }));
      c.position.set(Math.cos(a) * 7.05, -0.3, Math.sin(a) * 7.05); c.castShadow = true; group.add(c);
    }
    roadY = -1.25; sideMat = new THREE.MeshPhysicalMaterial({ color: '#FFB3DA', roughness: 0.3, clearcoat: 1 });
    // cloud sea + floating clouds
    for (let i = 0; i < 26; i++) {
      const a = i / 26 * 360 + rand(-6, 6), r = rand(10.5, 30);
      const c = addPolar('cloud' + (i % 3), r, a, rand(-5, -2.2), rand(2.2, 4), false);
      movers.push({ obj: c, base: c.position.clone(), ph: rand(0, 6), update(t) { this.obj.position.y = this.base.y + Math.sin(t * 0.4 + this.ph) * 0.25; } });
    }
    for (let i = 0; i < 9; i++) {
      const c = addPolar('cloud' + (i % 3), rand(16, 34), rand(0, 360), rand(3, 9), rand(1.4, 2.6), false);
      movers.push({ obj: c, ph: rand(0, 6), r: Math.hypot(c.position.x, c.position.z), a0: Math.atan2(c.position.z, c.position.x), y: c.position.y,
        update(t) { const a = this.a0 + t * 0.01; this.obj.position.set(Math.cos(a) * this.r, this.y + Math.sin(t * 0.3 + this.ph) * 0.3, Math.sin(a) * this.r); } });
    }
    const rb = add('rainbow', 0, -2.4, -24, 7.5, 0, false);
    rb.traverse(o => { if (o.isMesh && o.material.name?.startsWith('rb')) { o.material = o.material.clone(); o.material.emissive = o.material.color.clone(); o.material.emissiveIntensity = 0.35; } });
    // dressing on the cake (low in front, tall at the back/sides)
    // the benches for knocked-out pieces run along the left and right edges, so dressing stays clear of x≈±5.2
    for (const [n, r, a, s] of [['lollipop', 6.0, 8, 1.0], ['lollipop', 6.1, 352, 0.85], ['candycane', 6.5, 90, 1.0], ['candycane', 6.5, 270, 1.0],
      ['gumdrop0', 6.4, 62, 0.8], ['gumdrop1', 6.4, 298, 0.8], ['gumdrop2', 5.8, 180, 0.7], ['donut', 6.5, 125, 0.8], ['donut', 6.5, 235, 0.8],
      ['gumdrop1', 5.9, 158, 0.6], ['gumdrop0', 5.9, 202, 0.6]]) addPolar(n, r, a, -0.53, s);
    for (const [n, r, a, s] of [['candytree0', 12, 30, 1.6], ['candytree1', 13, 330, 1.8], ['candytree2', 12.5, 60, 1.5], ['candytree0', 13, 300, 1.4],
      ['candytree1', 12, 95, 1.3], ['candytree2', 12, 265, 1.3], ['lollipop', 11.5, 125, 1.6], ['lollipop', 11.5, 235, 1.6]]) {
      const o = addPolar(n, r, a, -2.3, s);
      const isle = make('cloud' + (Math.round(a) % 3)); isle.scale.setScalar(1.8); isle.position.set(o.position.x, -2.6, o.position.z); group.add(isle);
    }
    for (let i = 0; i < 4; i++) {
      const b = addPolar('balloon', rand(18, 28), [20, 70, 290, 340][i], rand(4, 9), rand(1.8, 2.6), false);
      movers.push({ obj: b, base: b.position.clone(), ph: rand(0, 6), update(t) { this.obj.position.y = this.base.y + Math.sin(t * 0.5 + this.ph) * 0.6; this.obj.rotation.y = t * 0.1 + this.ph; } });
    }
  }

  if (id === 'spooky') {
    const groundMat = new THREE.MeshStandardMaterial({ color: '#2a2140', roughness: 0.95 });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64), groundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -1.0; ground.receiveShadow = true; group.add(ground);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(6.9, 7.3, 0.6, 12), new THREE.MeshStandardMaterial({ color: '#4a3d6b', roughness: 0.8, flatShading: true }));
    plinth.position.y = -0.82; plinth.receiveShadow = true; plinth.castShadow = true; group.add(plinth);
    roadY = -0.97; sideMat = new THREE.MeshStandardMaterial({ color: '#2c2245', roughness: 0.9 });
    // the moon
    const moon = new THREE.Mesh(new THREE.SphereGeometry(7, 48, 24), new THREE.MeshBasicMaterial({ color: '#fff3c4', fog: false }));
    moon.position.set(-24, 30, -95); group.add(moon);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(128, 128, (g, w) => { const gr = g.createRadialGradient(64, 64, 10, 64, 64, 64); gr.addColorStop(0, 'rgba(255,240,200,0.75)'); gr.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); }), fog: false, depthWrite: false, transparent: true }));
    halo.position.copy(moon.position); halo.scale.setScalar(40); group.add(halo);
    add('castle', 4, -1.0, -30, 4.5, 0.15, false);
    for (const [n, r, a, s] of [['grave0', 5.6, 350, 0.9], ['grave1', 5.7, 12, 0.85], ['pumpkin0', 6.4, 90, 0.9], ['pumpkin1', 6.4, 270, 0.95], ['candles', 6.3, 60, 0.9],
      ['candles', 6.3, 300, 0.9], ['pumpkin2', 5.7, 160, 0.8], ['pumpkin1', 5.7, 200, 0.8], ['shrooms', 6.3, 122, 1.1], ['shrooms', 6.3, 238, 1.1]]) addPolar(n, r, a, -0.52, s);
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * 360 + 12;
      if (a > 140 && a < 220) continue;
      addPolar('fence', 10.6, a, -1.0, 1.4).lookAt(0, -1, 0);
    }
    for (const [n, r, a, s] of [['spookytree0', 13, 25, 2.2], ['spookytree1', 14, 335, 2.4], ['spookytree0', 12.5, 75, 2.0], ['spookytree1', 12.5, 285, 2.1],
      ['spookytree0', 16, 120, 2.4], ['spookytree1', 16, 240, 2.4], ['grave0', 12, 50, 1.4], ['grave1', 12, 310, 1.4], ['pumpkin0', 11.5, 100, 1.6],
      ['pumpkin2', 11.5, 260, 1.6], ['grave1', 13.5, 145, 1.3], ['grave0', 13.5, 215, 1.3], ['shrooms', 11.6, 160, 1.8], ['shrooms', 11.6, 200, 1.8]]) addPolar(n, r, a, -1.0, s);
    // warm glows from the lanterns and pumpkins
    for (const [r, a] of [[6.4, 90], [6.4, 270], [11.5, 100], [11.5, 260]]) {
      const [x, z] = place(r, a);
      const l = new THREE.PointLight('#ff9f43', 6, 7, 1.6); l.position.set(x, 0.4, z); group.add(l);
    }
    for (let i = 0; i < 10; i++) {
      const lan = addPolar('lantern', rand(10.5, 16), rand(0, 360), rand(2.5, 5.5), 1.1, false);
      movers.push({ obj: lan, base: lan.position.clone(), ph: rand(0, 6), update(t) { this.obj.position.y = this.base.y + Math.sin(t * 0.7 + this.ph) * 0.35; this.obj.rotation.y = t * 0.3; } });
    }
    for (let i = 0; i < 7; i++) {
      const bat = make('bat'); bat.scale.setScalar(rand(1.4, 2.0)); group.add(bat);
      const wings = [find(bat, 'wingL'), find(bat, 'wingR')];
      movers.push({ obj: bat, r: rand(11, 20), y: rand(3, 8), sp: rand(0.25, 0.45) * (i % 2 ? 1 : -1), ph: rand(0, 6), wings,
        update(t) {
          const a = t * this.sp + this.ph;
          this.obj.position.set(Math.cos(a) * this.r, this.y + Math.sin(t * 2 + this.ph) * 0.5, Math.sin(a) * this.r);
          this.obj.rotation.y = -a + (this.sp > 0 ? Math.PI : 0);
          const f = Math.sin(t * 16 + this.ph) * 0.7;
          if (this.wings[0]) this.wings[0].rotation.x = f;
          if (this.wings[1]) this.wings[1].rotation.x = -f;
        } });
    }
    // fireflies
    const n = 120, pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = rand(0, 6.28), r = rand(5, 22); pts.set([Math.cos(a) * r, rand(-0.5, 4), Math.sin(a) * r], i * 3); }
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const ff = new THREE.Points(fg, new THREE.PointsMaterial({ color: '#d9ff7a', size: 0.12, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false }));
    group.add(ff);
    movers.push({ obj: ff, base: pts.slice(), update(t) {
      const p = this.obj.geometry.attributes.position;
      for (let i = 0; i < n; i++) { p.array[i * 3] = this.base[i * 3] + Math.sin(t * 0.6 + i) * 0.4; p.array[i * 3 + 1] = this.base[i * 3 + 1] + Math.sin(t * 0.9 + i * 1.7) * 0.3; }
      p.needsUpdate = true; this.obj.material.opacity = 0.65 + 0.35 * Math.sin(t * 3);
    } });
  }

  if (id === 'galaxy') {
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(7.0, 5.6, 1.2, 8, 1), new THREE.MeshPhysicalMaterial({ color: '#2a2370', roughness: 0.25, metalness: 0.3, clearcoat: 1, flatShading: true }));
    plat.position.y = -1.13; plat.receiveShadow = true; group.add(plat);
    const edge = new THREE.Mesh(new THREE.TorusGeometry(6.98, 0.05, 8, 8), new THREE.MeshBasicMaterial({ color: '#4de1ff', toneMapped: false }));
    edge.rotation.x = Math.PI / 2; edge.position.y = -0.53; group.add(edge);
    const under = new THREE.Mesh(new THREE.ConeGeometry(5.6, 3.5, 8), new THREE.MeshPhysicalMaterial({ color: '#3a2a8c', roughness: 0.3, flatShading: true, emissive: '#7a2cff', emissiveIntensity: 0.25 }));
    under.position.y = -3.48; under.rotation.set(Math.PI, 0, 0); group.add(under);
    roadY = -1.4; wave = a => Math.sin(a * 3) * 0.55;
    roadMat.transparent = true; roadMat.opacity = 0.88; roadMat.depthWrite = true;
    sideMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.25 });
    const p1 = add('planet_ringed', -34, 14, -70, 9, 0.3, false);
    const p2 = add('planet_gas', 42, 22, -80, 8, 0, false);
    const p3 = add('planet_moon', 28, -6, -40, 3.2, 0, false);
    movers.push({ obj: p1, update(t) { this.obj.rotation.y = t * 0.03; } }, { obj: p2, update(t) { this.obj.rotation.y = -t * 0.05; } }, { obj: p3, update(t) { this.obj.rotation.y = t * 0.08; } });
    for (let i = 0; i < 16; i++) {
      const a = rand(0, 360), r = rand(11.5, 26);
      const o = addPolar('asteroid' + (i % 3), r, a, rand(-4, 5), rand(0.8, 2.2), false);
      const spin = new THREE.Vector3(rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4));
      movers.push({ obj: o, base: o.position.clone(), spin, ph: rand(0, 6), update(t, dt) { this.obj.rotation.x += this.spin.x * dt; this.obj.rotation.y += this.spin.y * dt; this.obj.position.y = this.base.y + Math.sin(t * 0.5 + this.ph) * 0.4; } });
      if (i < 6) { const c = make('crystal' + (i % 2)); c.position.set(0, 0.25, 0); c.scale.setScalar(0.5); o.add(c); }
    }
    for (const [n, r, a, s] of [['crystal0', 5.9, 0, 1.1], ['crystal1', 6.4, 90, 0.9], ['crystal1', 6.4, 270, 0.9], ['star', 5.6, 180, 0.6], ['crystal0', 5.8, 340, 0.8], ['crystal0', 5.8, 20, 0.8]]) addPolar(n, r, a, n === 'star' ? 0.1 : -0.53, s);
    const ufo = make('ufo'); ufo.scale.setScalar(2.2); group.add(ufo);
    movers.push({ obj: ufo, update(t) { const a = t * 0.18; this.obj.position.set(Math.cos(a) * 14, 6 + Math.sin(t * 1.3) * 0.6, Math.sin(a) * 14 - 4); this.obj.rotation.y = t * 0.8; this.obj.rotation.z = Math.sin(t) * 0.12; } });
    const sat = add('satellite', 18, 9, -14, 2.0, 0.6, false);
    movers.push({ obj: sat, update(t) { this.obj.rotation.y = t * 0.2; this.obj.rotation.z = t * 0.1; } });
    for (let i = 0; i < 5; i++) {
      const st = addPolar('star', rand(14, 26), rand(0, 360), rand(4, 10), rand(1.2, 2.2), false);
      movers.push({ obj: st, ph: rand(0, 6), update(t) { this.obj.rotation.y = t * 0.7 + this.ph; } });
    }
    // shooting stars
    const streakMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, toneMapped: false, depthWrite: false });
    const streak = new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.08, 6, 6), streakMat); streak.visible = false; group.add(streak);
    movers.push({ obj: streak, next: 2, life: 0, from: new THREE.Vector3(), dir: new THREE.Vector3(), update(t, dt) {
      if (t > this.next && !this.life) { this.life = 1; this.next = t + rand(3, 7); this.from.set(rand(-40, 40), rand(18, 30), rand(-60, -30)); this.dir.set(rand(-1, 1), -0.45, rand(0.2, 0.6)).normalize(); }
      if (this.life > 0) {
        this.life -= dt * 1.2; const k = 1 - this.life;
        this.obj.visible = this.life > 0; this.obj.position.copy(this.from).addScaledVector(this.dir, k * 40);
        this.obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.dir.clone().negate());
        streakMat.opacity = Math.sin(Math.PI * Math.max(0, k));
        if (this.life <= 0) this.life = 0;
      }
    } });
    const rim1 = new THREE.PointLight('#ff4fd8', 12, 30, 1.5); rim1.position.set(-9, 4, -6); group.add(rim1);
    const rim2 = new THREE.PointLight('#4de1ff', 12, 30, 1.5); rim2.position.set(9, 4, -6); group.add(rim2);
  }

  // the kart track around the board + karts driven by pawns + item boxes on the road
  const road = makeRoad(R_IN, R_OUT, roadY, 220, wave, roadMat, sideMat);
  group.add(road);
  const trackY = a => roadY + wave(a);
  const kartColors = ['#ff4f6d', '#4db5ff', '#ffd23f', '#5be38a'];
  for (let i = 0; i < 3; i++) {
    const kart = make('kart'); kart.scale.setScalar(0.85);
    kart.traverse(o => { if (o.isMesh && o.material.name?.startsWith('kartbody')) { o.material = o.material.clone(); o.material.color.set(kartColors[i]); } });
    const driver = paintTeam(make(id + '_pawn'), id, i % 2 ? 'dark' : 'light');
    for (const b of findAll(driver, 'base')) b.visible = false;
    driver.scale.setScalar(0.85); driver.position.set(-0.12, 0.1, 0); driver.rotation.y = Math.PI / 2;
    kart.add(driver);
    const holder = new THREE.Group(); holder.add(kart); kart.rotation.y = 0; group.add(holder);
    const lane = R_MID + (i - 1) * 0.5;
    movers.push({ obj: holder, kart, lane, sp: 0.16 + i * 0.035, ph: i * 2.1, update(t) {
      const a = this.ph + t * this.sp, y = trackY(a);
      const r = this.lane + Math.sin(t * 0.7 + this.ph) * 0.25;
      this.obj.position.set(Math.cos(a) * r, y + Math.abs(Math.sin(t * 9 + this.ph)) * 0.04, Math.sin(a) * r);
      this.obj.rotation.y = -a - Math.PI;     // drive along the tangent
      const slope = (trackY(a + 0.02) - y) / (0.02 * r);
      this.kart.rotation.z = -Math.atan(slope); this.kart.rotation.x = -0.08;
    } });
  }
  const boxMat = itemBoxMaterial();
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + 0.3;
    const b = make('item_box'); styleItemBox(b, boxMat); b.scale.setScalar(0.9);
    b.position.set(Math.cos(a) * R_MID, trackY(a) + 0.35, Math.sin(a) * R_MID); group.add(b);
    movers.push({ obj: b, ph: i, y: b.position.y, update(t) { this.obj.rotation.y = t * 1.2 + this.ph; this.obj.rotation.x = 0.3; this.obj.position.y = this.y + Math.sin(t * 2 + this.ph) * 0.08; } });
  }

  return {
    id, cfg, group, sky, sun, hemi,
    update(t, dt) { sky.material.uniforms.time.value = t; boxMat.userData.update?.(t); for (const m of movers) m.update(t, dt); },
  };
}

// ---------------------------------------------------------------- the rainbow "?" box material
export function itemBoxMaterial() {
  // candy-glass cube whose colour runs through the rainbow (Mario-Kart item box feel)
  const m = new THREE.MeshPhysicalMaterial({
    color: '#ff6fb5', roughness: 0.08, metalness: 0.0, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.8,
    iridescenceThicknessRange: [200, 900], transparent: true, opacity: 0.93, emissive: '#ff6fb5', emissiveIntensity: 0.5,
  });
  m.userData.update = t => { const h = (t * 0.12) % 1; m.color.setHSL(h, 1, 0.52); m.emissive.setHSL((h + 0.08) % 1, 1, 0.42); };
  return m;
}
export function styleItemBox(box, mat) {
  box.traverse(o => {
    if (!o.isMesh) return;
    if (o.material.name?.startsWith('itembox')) { o.material = mat; o.castShadow = false; }
    else { o.material = o.material.clone(); o.material.toneMapped = false; }
  });
}
