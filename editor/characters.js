import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const models = new Map();
export const characterAssets = [
  { id: 'performer', name: 'Human performer', detail: 'Skinned human · walk cycle', url: './assets/performer.glb', icon: '◉' },
  { id: 'robot', name: 'Expressive robot', detail: '14 animations · gestures', url: './assets/robot.glb', icon: '▣' },
];
export async function loadModel(asset) {
  if(asset.gltf)return asset.gltf;
  if (!models.has(asset.id)) {
    const pending = loader.loadAsync(asset.url).catch(error => { models.delete(asset.id); throw error; });
    models.set(asset.id, pending);
  }
  return models.get(asset.id);
}
export async function importModel(file, id) {
  if (!file.name.toLowerCase().endsWith('.glb')) throw new Error('Choose a self-contained .glb file.');
  if (file.size > 50 * 1024 * 1024) throw new Error('Keep models under 50 MB for this prototype.');
  const buffer = await file.arrayBuffer();
  // Local imports must embed their resources; never fetch URLs supplied by a model.
  const view = new DataView(buffer);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('This is not a valid GLB file.');
  const length = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  if ([...(json.buffers ?? []), ...(json.images ?? [])].some(item => item.uri && !item.uri.startsWith('data:'))) {
    throw new Error('Embed textures and buffers in the GLB before importing.');
  }
  const gltf = await loader.parseAsync(buffer, '');
  models.set(id, Promise.resolve(gltf));
  return { id, name: file.name.replace(/\.glb$/i, ''), detail: `${gltf.animations.length} animations · imported`, icon: '◇', buffer, gltf };
}
export function normalizedModel(gltf, height, fitHeight = true) {
  const model = new THREE.Group();
  model.add(clone(gltf.scene));
  model.updateMatrixWorld(true);
  model.traverse(o => { if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox(); } });
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = height / Math.max(fitHeight ? size.y : Math.max(size.x,size.y,size.z), 0.01);
  model.scale.multiplyScalar(scale);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return model;
}
export async function createActor(asset, spec) {
  const gltf = await loadModel(asset);
  const group = new THREE.Group();
  const model = normalizedModel(gltf, 1.85);
  group.add(model);
  group.position.set(...spec.position);
  group.traverse(o => o.userData.actor = true);
  const mixer = new THREE.AnimationMixer(model);
  const clips = gltf.animations.map((clip, i) => {
    const copy = clip.clone();
    copy.name = asset.id === 'performer' ? 'Walk' : clip.name || `Walk ${i + 1}`;
    return copy;
  });
  if (!clips.some(c => /idle|standing/i.test(c.name))) clips.push(makeIdleClip(clips));
  const actions = Object.fromEntries(clips.map(c => [c.name, mixer.clipAction(c)]));
  const names = Object.keys(actions);
  const idle = names.find(n => /idle|standing/i.test(n));
  const walk = names.find(n => /walk/i.test(n)) ?? idle;
  const run = names.find(n => /running|run/i.test(n)) ?? walk;
  const actor = { group, spec, mixer, actions, idle, walk, run, clip: idle, clipTime: 0, wp: 0, gesture: '', assetId: asset.id,
    layers: {}, velocity: new THREE.Vector2(), directed: false, present: true };
  for (const [name, action] of Object.entries(actions)) {
    action.play().setEffectiveWeight(0);
    actor.layers[name] = { time: 0, weight: name === idle ? 1 : 0 };
  }
  poseActor(actor, idle, 0, actor.layers);
  return actor;
}

// Models without idle clips get a neutral stance averaged over their walk cycle,
// then a small breathing motion. This avoids stopping on one airborne walk frame.
function makeIdleClip(clips) {
  const source = clips.find(c => /walk/i.test(c.name)) ?? clips[0];
  const tracks = [];
  for (const track of source?.tracks ?? []) {
    const n = track.getValueSize(), interpolant = track.createInterpolant();
    const average = new Array(n).fill(0);
    const q = new THREE.Quaternion();
    for (let i = 0; i < 24; i++) {
      const value = interpolant.evaluate(source.duration * i / 24);
      if (track.ValueTypeName === 'quaternion') {
        if (!i) q.fromArray(value); else q.slerp(new THREE.Quaternion().fromArray(value), 1 / (i + 1));
      } else for (let j = 0; j < n; j++) average[j] += value[j] / 24;
    }
    const value = track.ValueTypeName === 'quaternion' ? q.normalize().toArray() : average;
    const middle = [...value];
    if (track.name.endsWith('.scale') && /torso|spine|chest/i.test(track.name)) middle[1] *= 1.012;
    tracks.push(new track.constructor(track.name, [0, 1.6, 3.2], [...value, ...middle, ...value]));
  }
  return new THREE.AnimationClip('Idle (breathing)', 3.2, tracks);
}

export function poseActor(actor, clip, time, layers = null) {
  const state = layers ?? { [clip || actor.idle]: { time, weight: 1 } };
  for (const [name, action] of Object.entries(actor.actions)) {
    const layer = state[name] ?? { time: 0, weight: 0 };
    action.enabled = true; action.paused = false;
    action.time = layer.time % Math.max(action.getClip().duration, .001);
    action.setEffectiveWeight(layer.weight);
  }
  actor.mixer.update(0);
  actor.clip = clip; actor.clipTime = time;
  actor.layers = Object.fromEntries(Object.keys(actor.actions).map(name => [name, { ...(state[name] ?? {time:0,weight:0}) }]));
}

export function animateActor(actor, clip, dt, rate = 1) {
  clip = actor.actions[clip] ? clip : actor.idle;
  if (clip !== actor.clip) {
    const old = actor.layers[actor.clip];
    const locomotion = [actor.walk, actor.run];
    actor.layers[clip].time = locomotion.includes(clip) && locomotion.includes(actor.clip)
      ? old.time / actor.actions[actor.clip].getClip().duration * actor.actions[clip].getClip().duration : 0;
  }
  for (const [name, layer] of Object.entries(actor.layers)) {
    const target = name === clip ? 1 : 0;
    layer.weight = THREE.MathUtils.clamp(layer.weight + Math.sign(target - layer.weight) * dt / .22, 0, 1);
    if (layer.weight > 0 || name === clip) layer.time += dt * (name === clip ? rate : 1);
  }
  const total = Object.values(actor.layers).reduce((sum, x) => sum + x.weight, 0);
  for (const layer of Object.values(actor.layers)) layer.weight /= total || 1;
  poseActor(actor, clip, actor.layers[clip].time, actor.layers);
}

export function blendLayers(from, to, alpha) {
  return Object.fromEntries(Object.keys(from).map(name => {
    const a = from[name], b = to[name] ?? a;
    return [name, { time: b.time >= a.time ? THREE.MathUtils.lerp(a.time, b.time, alpha) : a.time,
      weight: THREE.MathUtils.lerp(a.weight, b.weight, alpha) }];
  }));
}
