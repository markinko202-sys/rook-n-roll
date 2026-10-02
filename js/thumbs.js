// Little transparent PNG portraits of 3D models (avatars, item icons, arena cards, promotion choices),
// rendered once in a separate small WebGL canvas and cached as data URLs.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { make, findAll } from './assets.js?v=1';
import { paintTeam } from './arenas.js?v=1';

let r = null, scene, cam, pmrem;
const cache = new Map();

function init() {
  r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
  scene = new THREE.Scene();
  pmrem = new THREE.PMREMGenerator(r);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight('#ffffff', '#b9a6ff', 1.2));
  const d = new THREE.DirectionalLight('#ffffff', 2.2); d.position.set(2, 4, 5); scene.add(d);
  cam = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
}

// objs: Object3D list laid out left→right; returns data URL
export function shot(key, objs, { w = 256, h = 256, spacing = 0.85, pitch = 0.18, yaw = -0.35 } = {}) {
  if (cache.has(key)) return cache.get(key);
  if (!r) init();
  r.setSize(w, h, false);
  const g = new THREE.Group();
  objs.forEach((o, i) => { o.position.x = (i - (objs.length - 1) / 2) * spacing; o.rotation.y = yaw; g.add(o); });
  scene.add(g);
  const box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  cam.aspect = w / h; cam.updateProjectionMatrix();
  const fit = Math.max(size.y, size.x / cam.aspect) * 0.5 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.12;
  cam.position.set(c.x, c.y + Math.sin(pitch) * fit, c.z + Math.cos(pitch) * fit + size.z * 0.5);
  cam.lookAt(c);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  scene.remove(g);
  cache.set(key, url);
  return url;
}

export function figure(arena, type, team, { base = true } = {}) {
  const o = paintTeam(make(`${arena}_${type}`), arena, team);
  if (!base) for (const b of findAll(o, 'base')) b.visible = false;
  return o;
}
export const pieceShot = (arena, type, team) => shot(`p-${arena}-${type}-${team}`, [figure(arena, type, team, { base: false })], { w: 192, h: 192 });
export const itemShot = id => shot(`i-${id}`, [make('icon_' + id)], { w: 160, h: 160, yaw: id === 'warp' ? 0 : -0.4, pitch: id === 'warp' ? 0 : 0.25 });
export const arenaShot = arena => shot(`a-${arena}`, [figure(arena, 'knight', 'light', { base: false }), figure(arena, 'king', 'light', { base: false }), figure(arena, 'queen', 'dark', { base: false })], { w: 420, h: 220, spacing: 0.72, yaw: -0.25 });
