// Loads the Blender-made GLB files (Draco-compressed). Every top-level node becomes a prototype to clone.
// Pieces and dressing of the chosen arena load first; the other arenas stream in behind the menu.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const VERSION = '1';
export const lib = {};
export let palettes = null;

const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/libs/draco/gltf/');
const loader = new GLTFLoader().setDRACOLoader(draco);
const pending = {};

function loadFile(f) {
  return (pending[f] ||= loader.loadAsync(`assets/${f}.glb?v=${VERSION}`).then(gltf => {
    for (const node of [...gltf.scene.children]) {
      node.position.set(0, 0, 0);
      node.traverse(o => {
        if (!o.isMesh) return;
        const m = o.material;
        o.geometry.userData.keep = true;
        o.castShadow = !(m.transparent && m.opacity < 0.9);
        o.receiveShadow = true;
        if (m.emissiveIntensity > 1) m.emissiveIntensity = Math.min(m.emissiveIntensity, 2.5);
      });
      lib[node.name] = node;
    }
  }));
}

export const ARENA_FILES = { candy: ['pieces_candy', 'kit_candy'], spooky: ['pieces_spooky', 'kit_spooky'], galaxy: ['pieces_galaxy', 'kit_galaxy'] };

export async function loadCore(first, onProgress) {
  palettes ||= await fetch(`assets/palettes.json?v=${VERSION}`).then(r => r.json());
  const files = ['common', ...ARENA_FILES[first]];
  let done = 0;
  await Promise.all(files.map(f => loadFile(f).then(() => onProgress?.(++done / files.length))));
  for (const a of Object.keys(ARENA_FILES)) if (a !== first) ARENA_FILES[a].forEach(f => loadFile(f).catch(e => console.warn('load failed', f, e)));
}
export function ensureArena(a) { return Promise.all(ARENA_FILES[a].map(loadFile)); }

export function make(name) {
  const p = lib[name];
  if (!p) { console.warn('missing asset', name); return new THREE.Group(); }
  return p.clone(true);
}

// find a descendant by base name (Blender ".001" suffixes arrive as "001"; GLTFLoader may add "_1")
export function findAll(root, base) {
  const out = [];
  root.traverse(o => { if (o.name === base || o.name.replace(/(_\d+|\d{3})+$/, '') === base) out.push(o); });
  return out;
}
export const find = (root, base) => findAll(root, base)[0] || null;
