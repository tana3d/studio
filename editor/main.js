import * as THREE from 'three';
import { editableScene } from './scenes.js';
import { characterAssets, createActor, animateActor, poseActor, importModel, normalizedModel, blendLayers } from './characters.js';
import { CameraTimeline } from './camera-timeline.mjs';
import { CameraTransitions } from './camera-transitions.js';
import { PerformanceTimeline } from './performance.mjs';
import { EditHistory } from './history.mjs';
import { extraAssets, buildExtra } from './props-extra.js';
import { zipSync, strToU8 } from 'fflate';
import './desktop.js';
import { createCatalog, libraryNative, bufferBase64, modelFile } from './catalog.js';
import { resolvePlacement } from './agent-placement.mjs';
import { createSceneBridge } from './rixse-scene.mjs';

// ============================================================
// THE WORLD IS DATA.
// This object is the entire demo's argument: a scene is a JSON
// document. Hand-written today; later, an LLM writes this.
// ============================================================
const SCENE = {
  meta: { title: "Alley, 2AM — scene 001" },
  environment: {
    sky: "#05070d",
    fog: { color: "#0a0f1a", density: 0.027 },
    ground: { width: 12, length: 56, center: [0, 0, -16], color: "#141a24", roughness: 0.3, metalness: 0.5 },
    buildings: [
      { side: "left",  color: "#1a2030", windows: { litRatio: 0.28, warm: "#ffb066", cool: "#7fd4ff" } },
      { side: "right", color: "#171c29", windows: { litRatio: 0.2,  warm: "#ffb066", cool: "#7fd4ff" } }
    ],
    props: [
      { type: "streetlamp", position: [-3.2, 0, -10], color: "#ffd9a0", flicker: true },
      { type: "neonSign", position: [4.45, 4.2, -18], facing: "left",  color: "#ff2d95", size: [2.4, 0.9] },
      { type: "neonSign", position: [-4.45, 5.4, -30], facing: "right", color: "#35e0ff", size: [1.7, 1.7] },
      { type: "dumpster", position: [3.1, 0, -6] },
      { type: "crate", position: [-2.9, 0, 3] },
      { type: "crate", position: [-2.3, 0, 3.7] },
      { type: "puddle", position: [1.2, 0.01, -14], size: [2.6, 1.4] }
    ],
    rain: { count: 900, area: [14, 12, 56], wind: -0.6 }
  },
  characters: [
    {
      name: "Vale", assetId: "performer",
      look: { coat: "#4a5878", skin: "#c9a186" },
      position: [0, 0, -8],
      path: [[0, 0, -8], [0, 0, -24], [1.8, 0, -24], [1.8, 0, -8]],
      speed: 1.15
    }
  ],
  cameras: [
    { name: "POV",      type: "player" },
    { name: "Crane",    type: "static", position: [3.4, 7, 5], lookAt: [0, 1.0, -18] },
    { name: "Dolly",    type: "track", target: "Vale", offset: [4.2, 1.6, 2.8] },
    { name: "Close-Up", type: "track", target: "Vale", offset: [1.7, 1.55, 1.5] }
  ]
};

// ============================================================
// BUILDERS — prop types map to functions. This is the
// vocabulary an agent would later call as tools.
// ============================================================
const colliders = [];   // {minX, maxX, minZ, maxZ, y, h}
const flickering = [];
const collider = (x, z, w, d) => colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, y: 0, h: 0.7 });

function buildStreetlamp(parent, p) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.6, metalness: 0.8 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 4.6, 8), dark);
  pole.position.y = 2.3; pole.castShadow = true; g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.08), dark);
  arm.position.set(0.45, 4.55, 0); g.add(arm);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x11131a, emissive: new THREE.Color(p.color), emissiveIntensity: 2.2 });
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.24), headMat);
  head.position.set(0.9, 4.5, 0); g.add(head);
  const spot = new THREE.SpotLight(new THREE.Color(p.color), 260, 18, 0.55, 0.45, 1.8);
  spot.position.set(0.9, 4.45, 0);
  spot.target.position.set(0.9, 0, 0);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  g.add(spot, spot.target);
  if (p.flicker) flickering.push({ light: spot, base: 260, mat: headMat, t: 0 });
  g.position.set(...p.position);
  parent.add(g);
  collider(p.position[0], p.position[2], 0.3, 0.3);
}

function buildNeonSign(parent, p) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x0a0a0e, emissive: new THREE.Color(p.color), emissiveIntensity: 2.6 });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(p.size[0], p.size[1], 0.1), mat);
  sign.position.set(...p.position);
  // wall-mounted: orientation handled by the pivot (baseRotY); else legacy left/right
  const ry = p.normal ? 0 : (p.facing === "left" ? -Math.PI / 2 : Math.PI / 2);
  sign.rotation.y = ry;
  parent.add(sign);
  const off = p.normal ? [0, 0, 0.6] : (p.facing === "left" ? [-0.6, 0, 0] : [0.6, 0, 0]);
  const glow = new THREE.PointLight(new THREE.Color(p.color), 40, 14, 1.8);
  glow.position.set(p.position[0] + off[0], p.position[1] + off[1], p.position[2] + off[2]);
  parent.add(glow);
}

function buildDumpster(parent, p) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x1d2b22, roughness: 0.75, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.05, 1.05), mat);
  body.position.set(p.position[0], p.position[1] + 0.55, p.position[2]); body.castShadow = true; parent.add(body);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 1.05), mat);
  lid.position.set(p.position[0], p.position[1] + 1.12, p.position[2] - 0.06); lid.rotation.x = -0.14; parent.add(lid);
  collider(p.position[0], p.position[2], 2.0, 1.2);
}

function buildCrate(parent, p) {
  const c = new THREE.Mesh(
    new THREE.BoxGeometry(0.68, 0.68, 0.68),
    new THREE.MeshStandardMaterial({ color: 0x4a3a26, roughness: 0.85 })
  );
  c.position.set(p.position[0], p.position[1] + 0.34, p.position[2]);
  c.rotation.y = p.variation ??= Math.random() * 0.8; c.castShadow = true;
  parent.add(c);
  collider(p.position[0], p.position[2], 0.8, 0.8);
}

function buildPuddle(parent, p) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(1, 28),
    new THREE.MeshStandardMaterial({ color: 0x0a0e16, roughness: 0.04, metalness: 1.0 })
  );
  m.rotation.x = -Math.PI / 2;
  m.scale.set(p.size[0], p.size[1], 1);
  m.position.set(...p.position);
  parent.add(m);
}

function buildBuildings(parent, spec) {
  const left = spec.side === "left";
  const wallX = left ? -4.5 : 4.5;
  const cx = left ? -6.6 : 6.6;
  const faceRot = left ? Math.PI / 2 : -Math.PI / 2;
  for (let z = 6; z > -40; z -= 8) {
    const h = 9 + ((z * 7919) % 10 + 10) % 10;   // deterministic pseudo-random 9..18
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(4.2, h, 7.9),
      new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.9 })
    );
    b.position.set(cx, h / 2, z - 4);
    parent.add(b);
    const win = spec.windows;
    for (let y = 2.8; y < h - 1.4; y += 2.3) {
      for (let wz = z - 7.1; wz < z - 0.9; wz += 1.55) {
        const lit = Math.random() < win.litRatio;
        const warm = Math.random() < 0.6;
        const wm = new THREE.MeshStandardMaterial({
          color: 0x05070a,
          emissive: lit ? new THREE.Color(warm ? win.warm : win.cool) : new THREE.Color(0x000000),
          emissiveIntensity: lit ? 2.2 : 0
        });
        const w = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.85), wm);
        w.position.set(wallX + (left ? 0.02 : -0.02), y, wz);
        w.rotation.y = faceRot;
        parent.add(w);
      }
    }
  }
}

function buildRain(parent, spec) {
  const n = spec.count;
  const pos = new Float32Array(n * 3);
  const [ax, ay, az] = spec.area;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * ax;
    pos[i * 3 + 1] = Math.random() * ay;
    pos[i * 3 + 2] = 8 - Math.random() * az;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const rain = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0x9db4d0, size: 0.05, transparent: true, opacity: 0.55, depthWrite: false
  }));
  parent.add(rain);
  const initial = pos.slice();
  return { update(time) {
    const a = geo.attributes.position.array;
    for (let i = 0; i < n; i++) {
      a[i * 3 + 1] = ((initial[i * 3 + 1] - 17 * time) % ay + ay) % ay;
      a[i * 3] = ((initial[i * 3] + ax / 2 + spec.wind * time) % ax + ax) % ax - ax / 2;
    }
    geo.attributes.position.needsUpdate = true;
  } };
}

const PROP_DEFAULTS = {
  streetlamp: { color: '#ffd9a0', flicker: true },
  neonSign: { color: '#ff2d95', size: [2.2, 0.9], facing: 'left' },
  dumpster: {},
  crate: {},
  puddle: { size: [2.2, 1.2] }
};
// footprint [w, d] for validity/snapping (0 = walks over); height for stacking
const FOOTPRINTS = { streetlamp: [0.3, 0.3], neonSign: [0, 0], dumpster: [2.0, 1.2], crate: [0.8, 0.8], puddle: [0, 0] };
const PROP_HEIGHTS = { streetlamp: 4.6, neonSign: 0, dumpster: 1.2, crate: 0.7, puddle: 0 };

for (const asset of extraAssets) { PROP_DEFAULTS[asset.id] = {}; FOOTPRINTS[asset.id] = asset.size; PROP_HEIGHTS[asset.id] = asset.height; }
const PROP_BUILDERS = { ...Object.fromEntries(extraAssets.map(a => [a.id, (parent, spec) => { buildExtra(parent, spec); collider(spec.position[0], spec.position[2], ...a.size); }])), streetlamp: buildStreetlamp, neonSign: buildNeonSign, dumpster: buildDumpster, crate: buildCrate, puddle: buildPuddle };

// ---------- prop registry: every prop is pickable, movable, rotatable ----------
const props = [];
let propSeq = 0;
function addProp(spec) {
  spec.id ??= crypto.randomUUID();
  const group = new THREE.Group();
  group.userData.objectId = spec.id;
  const collBefore = colliders.length;
  const flickBefore = flickering.length;
  PROP_BUILDERS[spec.type](group, spec);
  // re-base: children become local to the prop's own pivot so it can rotate/lift
  const pivot = new THREE.Vector3(...spec.position);
  group.children.forEach(c => c.position.sub(pivot));
  group.position.copy(pivot);
  const id = propSeq++;
  group.traverse(o => o.userData.propId = id);
  scene.add(group);
  const h = PROP_HEIGHTS[spec.type] ?? 0.7;
  const rec = {
    id, spec, group,
    elev: spec.position[1] ?? 0,
    rotY: spec.rotationY ?? 0,
    baseRotY: spec.normal ? Math.atan2(spec.normal[0], spec.normal[2]) : 0,
    colliders: colliders.slice(collBefore),
    flickers: flickering.slice(flickBefore)
  };
  group.rotation.y = rec.baseRotY + rec.rotY;
  rec.colliders.forEach(c => { c.h = h; c.y = rec.elev; });
  props.push(rec);
  return rec;
}
function removeProp(rec) {
  scene.remove(rec.group);
  for (const c of rec.colliders) { const i = colliders.indexOf(c); if (i >= 0) colliders.splice(i, 1); }
  for (const f of rec.flickers) { const i = flickering.indexOf(f); if (i >= 0) flickering.splice(i, 1); }
  const pi = props.indexOf(rec); if (pi >= 0) props.splice(pi, 1);
  const si = SCENE.environment.props.indexOf(rec.spec); if (si >= 0) SCENE.environment.props.splice(si, 1);
  if (selected === rec) selected = null;
}
// rotation widens the axis-aligned footprint (conservative box)
function rotatedFootprint(rec) {
  const [w, d] = FOOTPRINTS[rec.spec.type] ?? [0, 0];
  const c = Math.abs(Math.cos(rec.rotY)), s = Math.abs(Math.sin(rec.rotY));
  return [w * c + d * s, w * s + d * c];
}
function setCollidersAt(rec) {
  const [w, d] = rotatedFootprint(rec);
  const x = rec.group.position.x, z = rec.group.position.z;
  for (const c of rec.colliders) {
    c.minX = x - w / 2; c.maxX = x + w / 2;
    c.minZ = z - d / 2; c.maxZ = z + d / 2;
    c.y = rec.elev;
  }
}
function updateSpec(rec) {
  rec.spec.position = [rec.group.position.x, rec.elev, rec.group.position.z];
  rec.spec.rotationY = +rec.rotY.toFixed(3);
  if (rec.spec.wall) rec.spec.normal = [Math.sin(rec.baseRotY), 0, Math.cos(rec.baseRotY)];
}
function validAt(x, z, w, d, elev, h, ignore = [], checkWalls = true) {
  const [min,max]=worldBounds();
  if ((checkWalls && (x<min[0]+w/2||x>max[0]-w/2)) || z<min[1]+d/2 || z>max[1]-d/2) return false;
  if (h === 0) return true;  // flat/hanging things never block
  return !colliders.some(c =>
    !ignore.includes(c) &&
    x + w / 2 > c.minX && x - w / 2 < c.maxX &&
    z + d / 2 > c.minZ && z - d / 2 < c.maxZ &&
    elev < c.y + c.h - 1e-6 && elev + h > c.y + 1e-6
  );
}
let snapOn = true;
function snapPos(x, z, w, d, ignore = []) {
  const g = 0.25;
  let sx = Math.round(x / g) * g, sz = Math.round(z / g) * g;
  const T = 0.5;
  for (const c of colliders) {
    if (ignore.includes(c)) continue;
    for (const v of [c.maxX + w / 2, c.minX - w / 2, c.minX + w / 2, c.maxX - w / 2])
      if (Math.abs(sx - v) < T) { sx = v; break; }
    for (const v of [c.maxZ + d / 2, c.minZ - d / 2, c.minZ + d / 2, c.maxZ - d / 2])
      if (Math.abs(sz - v) < T) { sz = v; break; }
  }
  return [sx, sz];
}

// ============================================================
// WORLD
// ============================================================
const renderer = new THREE.WebGLRenderer({ antialias: true });
const viewport=document.getElementById('viewport');
const previewPixelRatio=Math.min(devicePixelRatio,2);
const videoSettings={format:'mp4',quality:'standard',aspect:'landscape'};
const videoQualities={low:{height:720,bitrate:3_000_000},standard:{height:1080,bitrate:8_000_000},high:{height:1440,bitrate:16_000_000}};
const frameAspect=()=>videoSettings.aspect==='portrait'?9/16:16/9;
renderer.setSize(viewport.clientWidth,viewport.clientHeight,false);
renderer.setPixelRatio(previewPixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SCENE.environment.sky);
scene.fog = new THREE.FogExp2(new THREE.Color(SCENE.environment.fog.color), SCENE.environment.fog.density);

const g = SCENE.environment.ground;
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(g.width, g.length),
  new THREE.MeshStandardMaterial({ color: g.color, roughness: g.roughness, metalness: g.metalness })
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(...g.center);
ground.receiveShadow = true;
scene.add(ground);

scene.add(new THREE.AmbientLight(0x2a3450, 0.9));
const moon = new THREE.DirectionalLight(0x4a5a80, 1.0);
moon.position.set(-6, 14, 4);
scene.add(moon);

const setBackground=new THREE.Group();scene.add(setBackground);
SCENE.environment.buildings.forEach(b => buildBuildings(setBackground, b));
SCENE.environment.props.forEach(p => addProp(p));
const rain = SCENE.environment.rain ? buildRain(setBackground, SCENE.environment.rain) : null;

function worldBounds(){return SCENE.environment.bounds??[[-4.2,-39],[4.2,7.4]];}
function syncSetBackground(){
  const custom=SCENE.environment.customSet??false;setBackground.visible=!custom;
  scene.background=new THREE.Color(custom?'#a6b8ba':SCENE.environment.sky);
  scene.fog=new THREE.FogExp2(new THREE.Color(custom?'#a6b8ba':SCENE.environment.fog.color),custom ? .003 : SCENE.environment.fog.density);
  const [min,max]=worldBounds(),width=custom?max[0]-min[0]:g.width,length=custom?max[1]-min[1]:g.length;
  ground.geometry.dispose();ground.geometry=new THREE.PlaneGeometry(width,length);
  ground.position.set(custom?(min[0]+max[0])/2:g.center[0],custom?-.02:g.center[1],custom?(min[1]+max[1])/2:g.center[2]);
  ground.material.color.set(custom?'#7d8980':g.color);
  moon.color.set(custom?'#ffffff':'#4a5a80');moon.intensity=custom?2:1;
}
// ---------- characters ----------
const actors = {};
let controlled = null;
let controlMode = 'camera';
let selectedActor = 'Vale';
let worldTime = 0;
let loadingModels = 0;
const importedAssets = [];
let importSequence = 0;
const actorReady = Promise.all(SCENE.characters.map(async spec => {
  const actor = await createActor(characterAssets.find(a => a.id === spec.assetId), spec);
  actors[spec.name] = actor;
  scene.add(actor.group);
}));

// ---------- player ----------
const player = { pos: new THREE.Vector3(0, 1.7, 6), yaw: 0, pitch: 0, third: false };
const camera = new THREE.PerspectiveCamera(62, frameAspect(), 0.1, 200);
let look = null;  // {x, y} while left-dragging empty space
let drag = null;  // {kind:'prop'|'cam', rec, pos:[x,z], start:[x,z], valid, placing, lastMouse}
let selected = null;

// ---------- input ----------
const keys = {};
const movementCodes = ['KeyW','KeyA','KeyS','KeyD'];
addEventListener('keydown', e => {
  if ($('catalog-dialog').open||$('shot-insert-dialog').open||$('export-dialog').open) return;
  if (!$('preview-window').hidden) {
    if(e.code==='Escape'){e.preventDefault();closePreview();}
    return;
  }
  if (e.target.closest('input, select, textarea')) return;
  if(shotDrag){if(e.code==='Escape'){e.preventDefault();finishShotDrag(true);}return;}
  if(clipDrag){if(e.code==='Escape'){e.preventDefault();finishClipDrag(true);}return;}
  if ((e.metaKey || e.ctrlKey) && ['KeyZ','KeyY'].includes(e.code)) {
    e.preventDefault(); if (!e.repeat) undoRedo(e.code === 'KeyY' || e.shiftKey); return;
  }
  if((e.metaKey||e.ctrlKey)&&e.code==='KeyB'){
    e.preventDefault();if(!e.repeat)splitAtPlayhead();return;
  }
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (movementCodes.includes(e.code) && controlled && controlMode === 'character' && canEditWorld() && history.pending?.label !== 'Move character') history.begin('Move character');
  if (e.code === 'KeyF') enterFreeCamera();
  if (e.code === 'KeyR') toggleRec();
  if (e.code === 'KeyG' && canEditWorld() && !drag) { history.run('Toggle grid snapping', () => snapOn = !snapOn); hint(`snap ${snapOn ? 'on' : 'off'}`); }
  if (e.code === 'Escape') {
    if (drag?.placing) cancelPlacement(); else { select(null); selectedCam = null; }
    $('camera-menu').hidden = true;
  }
  if (e.code.startsWith('Digit')) { const i = +e.code.slice(5)-1; if (i < 0) enterFreeCamera(); else if(SCENE.cameras[i]) setCam(i); }
  if ((e.code === 'Delete' || e.code === 'Backspace') && !drag) {
    if(selectedShot && canEditTimeline()){e.preventDefault();deleteShot(selectedShot);}
    else if(selectedCam && canEditCameras()) { e.preventDefault();deleteCamera(selectedCam.spec); }
    else if(selected && canEditWorld()) { e.preventDefault(); history.run('Delete object', () => { removeProp(selected); refreshJson(); }); }
  }
  if (e.code === 'KeyQ' || e.code === 'KeyE') {
    const delta=(e.code==='KeyQ'?1:-1)*(e.shiftKey?Math.PI/36:Math.PI/12);
    if(controlMode==='character' && !drag && !selected)return;
    const activeSpec=editableCameraSpec();
    const cam=(drag?.kind==='prop'||selected)?null:drag?.kind==='cam'?drag.rec: (previewEdit?null:selectedCam) ?? (activeSpec && activeSpec.type!=='player' ? {spec:activeSpec} : null);
    if (cam && canEditCameras()) {
      if (!drag) history.begin('Rotate camera'); aimCamera(cam.spec,delta,0); if(!drag)history.commit();e.preventDefault();
    } else if (canEditWorld()) {
      const rec=drag?.kind==='prop'?drag.rec:selected;
      if(rec) { if(!drag)history.begin('Rotate object');rotateProp(rec,delta);if(!drag)history.commit();e.preventDefault(); }
    }
  }
});
addEventListener('keyup',e=>keys[e.code]=false);
addEventListener('blur',()=>{Object.keys(keys).forEach(k=>delete keys[k]);if(look?.moved && history.pending?.label==='Aim camera')history.commit();look=null;});

// ---------- camera rig ----------
let camIndex = -1; // Free is an editor view, never a camera in the world.
let selectedCam = null;
const freeRig = { pos: new THREE.Vector3(0, 1.7, 6), yaw: 0, pitch: 0 };
const cameraEdit=new CameraTimeline();
const transitions=new CameraTransitions(renderer), outgoingCamera=camera.clone();
let previewEdit=false, selectedShot=null, adjustingShot=false, shotDrag=null, pendingShot=null;
let cameraSequence = 0;
SCENE.cameras[0].name = 'Character';
SCENE.cameras.forEach(spec => spec.id = `camera-${++cameraSequence}`);
const camsEl = document.getElementById('cams');
function rebuildCamButtons() {
  camsEl.innerHTML = '';
  const free = document.createElement('button'); free.id = 'cam-free'; free.textContent = 'Free'; free.onclick = enterFreeCamera;
  makeCameraDraggable(free,'free');camsEl.appendChild(free);
  SCENE.cameras.forEach((c, i) => {
    const b = document.createElement('button'); b.textContent = `${i + 1} ${c.name}`; b.id = `cam-${i}`;
    b.onclick = () => setCam(i);makeCameraDraggable(b,c.id);
    if (c.type !== 'player') b.oncontextmenu = e => { e.preventDefault(); openCameraMenu(c, e.clientX, e.clientY); };
    camsEl.appendChild(b);
  });
  updateCamButtons();
}
function updateCamButtons() {
  [...camsEl.children].forEach(b => b.classList.toggle('active', !previewEdit && b.id === (camIndex < 0 ? 'cam-free' : `cam-${camIndex}`)));
}
function setCam(i) {
  if (drag) { hint('Finish placing the object or camera first.'); return; }
  if(recorder)return; previewEdit=false;adjustingShot=false;
  camIndex = i; select(null); selectedCam = camRegs.find(r => r.spec === SCENE.cameras[i]) ?? null;
  updateCamButtons();
}
function enterFreeCamera() {
  if (drag) { hint('Finish placing the object or camera first.'); return; }
  if(recorder)return; previewEdit=false;adjustingShot=false;
  camIndex = -1; selectedCam = null; select(null); updateCamButtons(); refreshCast();
  hint(controlMode==='character' ? `Free view · still controlling ${controlled}` : 'Free camera · WASD fly · Space / C up / down · right-drag look');
}
rebuildCamButtons();
const tmpV = new THREE.Vector3();
function editableCameraSpec(){return adjustingShot?cameraEdit.shots.find(s=>s.id===selectedShot)?.spec:previewEdit?null:SCENE.cameras[camIndex];}
function poseShot(target,spec){
  target.aspect=camera.aspect;target.fov=spec.fov??62;target.updateProjectionMatrix();
  const actor=actors[spec.target];
  if(spec.type==='track'&&actor){target.position.copy(actor.group.position).add(new THREE.Vector3(...spec.offset));target.lookAt(actor.group.position.clone().add(new THREE.Vector3(0,1.5,0)));}
  else {target.position.fromArray(spec.position);target.lookAt(...spec.lookAt);}
}
function updateCamera() {
  if(previewEdit){const sample=cameraEdit.sample(timeline.time,timeline.duration);if(sample){poseShot(camera,sample.shot.spec);return;}}
  const spec = SCENE.cameras[camIndex];
  if (!spec) {
    camera.position.copy(freeRig.pos);
    camera.quaternion.setFromEuler(new THREE.Euler(freeRig.pitch, freeRig.yaw, 0, 'YXZ'));
  } else if (spec.type === 'player') {
    const followed = actors[controlled] ?? actors[selectedActor];
    if (!followed) return;
    const p = followed.group.position;
    camera.position.set(p.x + Math.sin(player.yaw) * 3.4, p.y + 2.4 + player.pitch * 1.5, p.z + Math.cos(player.yaw) * 3.4);
    camera.lookAt(p.x, p.y + 1.25, p.z);
  } else if (spec.type === 'static') {
    camera.position.set(...spec.position); camera.lookAt(tmpV.set(...spec.lookAt));
  } else if (spec.type === 'track') {
    const a = actors[selectedActor] ?? actors[spec.target]; if (!a) return;
    const p = a.group.position;
    camera.position.set(p.x + spec.offset[0], p.y + spec.offset[1], p.z + spec.offset[2]);
    camera.lookAt(p.x, p.y + 1.5, p.z);
  }
}
function movePlayer(dt) {
  if (previewEdit || recorder || controlMode !== 'camera' || camIndex !== -1 || drag) return;
  const f = Number(!!keys.KeyW) - Number(!!keys.KeyS), s = Number(!!keys.KeyD) - Number(!!keys.KeyA);
  const up = Number(!!keys.Space) - Number(!!keys.KeyC);
  if (!f && !s && !up) return;
  const speed = (keys.ShiftLeft || keys.ShiftRight ? 8 : 4) * dt;
  const direction = new THREE.Vector3(s, 0, -f).applyEuler(new THREE.Euler(freeRig.pitch, freeRig.yaw, 0, 'YXZ'));
  direction.y += up; direction.normalize(); freeRig.pos.addScaledVector(direction, speed);
}
function pinCamera(spec) {
  if (spec.type === 'static') return;
  spec.type = 'static'; spec.position = camera.position.toArray();
  spec.lookAt = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(8)).toArray();
  delete spec.target; delete spec.offset; syncCameraGizmos();
}
function aimCamera(spec, dx, dy) {
  pinCamera(spec);
  const rig = new THREE.PerspectiveCamera(); rig.position.fromArray(spec.position); rig.lookAt(...spec.lookAt);
  const euler = new THREE.Euler().setFromQuaternion(rig.quaternion, 'YXZ');
  euler.y += dx; euler.x = THREE.MathUtils.clamp(euler.x + dy, -1.45, 1.45);
  const direction = new THREE.Vector3(0, 0, -1).applyEuler(euler).multiplyScalar(8);
  spec.lookAt = direction.add(rig.position).toArray();
  syncCameraGizmos(); refreshJson();
}
function translateCamera(rec, position) {
  const offset = new THREE.Vector3(...position).sub(new THREE.Vector3(...rec.spec.position));
  rec.spec.position = position;
  rec.spec.lookAt = new THREE.Vector3(...rec.spec.lookAt).add(offset).toArray();
  syncCameraGizmos(); refreshJson();
}

// ---------- right-click menu, toast, ground picking ----------
const ctxmenu = document.getElementById('ctxmenu');
const toast = document.getElementById('toast');
let ctxPoint = null, toastTimer = null;

function hint(msg) {
  toast.textContent = msg;
  toast.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.style.opacity = 0, 2600);
}

function refreshJson() {
  document.querySelector('#scenejson pre').textContent = JSON.stringify(SCENE, null, 1);
}

function groundPoint(cx, cy) {
  const p = surfacePoint(cx, cy);
  return p && !p.onWall ? { x: p.x, z: p.z } : null;
}

// raycast any surface (ground, walls, props); returns point + world normal
const surfRay = new THREE.Raycaster();
surfRay.params.Points = { threshold: 0 };
function surfacePoint(cx, cy) {
  surfRay.setFromCamera(viewportPoint(cx,cy),camera);
  const ignore = drag?.rec?.group;
  const hits = surfRay.intersectObjects(scene.children.filter(o => o !== ignore && o !== rain), true);
  for (const h of hits) {
    if (!h.face) continue;
    if (h.object.userData.propId != null || h.object.userData.cameraId != null || h.object.userData.actor) continue;  // don't stack on props/cams/actors
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    if (Math.abs(n.x) + Math.abs(n.y) + Math.abs(n.z) < 0.5) continue;
    return { x: h.point.x, y: h.point.y, z: h.point.z, normal: [n.x, n.y, n.z], onWall: Math.abs(n.y) < 0.5 };
  }
  return null;
}

// ---------- picking, ghost drag, placement, selection ----------
const raycaster = new THREE.Raycaster();
const camRegs = [];
function viewportPoint(cx,cy){
  const rect=renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2((cx-rect.left)/rect.width*2-1,-(cy-rect.top)/rect.height*2+1);
}

function pickAt(cx, cy) {
  raycaster.setFromCamera(viewportPoint(cx,cy),camera);
  const hits = raycaster.intersectObjects([...props.map(p => p.group), ...camRegs.filter(c=>c.gizmo.visible).map(c => c.gizmo)], true);
  if (!hits.length) return null;
  const u = hits[0].object.userData;
  if (u.propId != null) return { prop: props.find(p => p.id === u.propId) };
  if (u.cameraId) return { cam: camRegs.find(r => r.spec.id === u.cameraId) };
  return null;
}

// mode: null = normal, 'sel' = cyan highlight, 'bad' = red ghost
function setTint(rec, mode) {
  rec.group.traverse(o => {
    if (!o.isMesh || !o.material.emissive) return;
    const m = o.material;
    if (!m.userData.orig) m.userData.orig = { e: m.emissive.getHex(), i: m.emissiveIntensity };
    if (mode === 'bad') { m.emissive.setHex(0xff2233); m.emissiveIntensity = 1.4; }
    else if (mode === 'sel') {
      if (m.userData.orig.e !== 0) { m.emissive.setHex(m.userData.orig.e); m.emissiveIntensity = m.userData.orig.i * 1.5; }
      else { m.emissive.setHex(0x35e0ff); m.emissiveIntensity = 0.5; }
    }
    else { m.emissive.setHex(m.userData.orig.e); m.emissiveIntensity = m.userData.orig.i; }
  });
}

function select(rec) {
  if (selected && selected !== rec) setTint(selected, null);
  selected = rec;
  if (rec) {
    setTint(rec, 'sel');
    hint(`${rec.spec.type} selected — Q/E rotate · scroll raise/lower · Del remove`);
  }
}

function rotateProp(rec, delta) {
  const before=propBounds(rec),wall=SCENE.environment.customSet?null:before.min.x< -4.49?-4.5:before.max.x>4.49?4.5:null;
  rec.rotY += delta;
  rec.group.rotation.y = rec.baseRotY + rec.rotY;
  if(wall!==null){flushToWall(rec,wall);if(drag?.rec===rec)drag.pos=[rec.group.position.x,rec.group.position.z];}
  updateSpec(rec);
  refreshJson();
  revalidate(rec);
  if (!drag) setCollidersAt(rec);
}

function elevateProp(rec, dy) {
  rec.elev = Math.max(0, Math.min(9, rec.elev + dy));
  rec.group.position.y = rec.elev;
  updateSpec(rec);
  refreshJson();
  revalidate(rec);
}

function revalidate(rec) {
  if (!drag || drag.rec !== rec) return;
  const [w, d] = rotatedFootprint(rec);
  const bounds=propBounds(rec);
  const ok = bounds.min.x>=worldBounds()[0][0]-.301 && bounds.max.x<=worldBounds()[1][0]+.301 && validAt(drag.pos[0], drag.pos[1], w, d, rec.elev, PROP_HEIGHTS[rec.spec.type] ?? 0.7, rec.colliders,false);
  drag.valid = ok;
  setTint(rec, ok ? 'sel' : 'bad');
  window.__ghost = { valid: ok, x: drag.pos[0], z: drag.pos[1], elev: rec.elev, rotY: rec.rotY };
}

function propBounds(rec){
  rec.group.updateWorldMatrix(true,true);const bounds=new THREE.Box3();
  rec.group.traverse(o=>{if(o.isMesh){o.geometry.computeBoundingBox();bounds.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));}});
  return bounds;
}
function flushToWall(rec,wallX){
  const bounds=propBounds(rec),edge=wallX<0?bounds.min.x:bounds.max.x;
  rec.group.position.x+=wallX-edge+(wallX<0?.001:-.001);
}
function moveGhost(e) {
  const rec = drag.rec;
  drag.lastMouse = [e.clientX, e.clientY];
  if (drag.kind === 'cam') {
    const pt = surfacePoint(e.clientX, e.clientY); if (!pt) return;
    translateCamera(rec, [THREE.MathUtils.clamp(pt.x,worldBounds()[0][0]+.2,worldBounds()[1][0]-.2),rec.spec.position[1],THREE.MathUtils.clamp(pt.z,worldBounds()[0][1]+.2,worldBounds()[1][1]-.2)]);
    return;
  }
  const pt=surfacePoint(e.clientX,e.clientY);if(!pt)return;
  if(rec.spec.type==='neonSign'&&pt.onWall){
    rec.spec.wall=true;rec.baseRotY=Math.atan2(pt.normal[0],pt.normal[2]);
    // Library signs start with a legacy side-facing mesh; move that rotation to the pivot.
    if(!rec.spec.normal){rec.group.children.forEach(o=>{o.rotation.y=0;if(o.isPointLight)o.position.set(0,0,.6);});}
    rec.spec.normal=pt.normal;rec.elev=pt.y;rec.group.rotation.y=rec.baseRotY+rec.rotY;
    rec.group.position.set(pt.x,pt.y,pt.z);flushToWall(rec,pt.x);
    drag.pos=[rec.group.position.x,rec.group.position.z];revalidate(rec);return;
  }
  if(rec.spec.wall)return;
  const [w,d]=rotatedFootprint(rec);
  const [sx,sz]=snapOn?snapPos(pt.x,pt.z,w,d,rec.colliders):[pt.x,pt.z];
  rec.group.position.x=sx;rec.group.position.z=sz;
  // A wall hit places a floor prop against that wall. Near-wall snapping uses the
  // rendered mesh edge, not the padded walking/collision footprint.
  const bounds=propBounds(rec),side=pt.x<0?-1:1;
  const edge=side<0?bounds.min.x:bounds.max.x;
  if(pt.onWall&&Math.abs(pt.normal[0])>.9)flushToWall(rec,pt.x);
  else if(!SCENE.environment.customSet&&snapOn&&Math.abs(edge-side*4.5)<.5)flushToWall(rec,side*4.5);
  drag.pos=[rec.group.position.x,rec.group.position.z];
  revalidate(rec);
}

function finishDrag() {
  const rec = drag.rec;
  if (drag.kind === 'prop') {
    if (!drag.valid) {
      rec.group.position.x = drag.start[0];
      rec.group.position.z = drag.start[1];
      rec.elev = drag.startElev;
      rec.group.position.y = rec.elev;
      rec.rotY = drag.startRot;
      rec.group.rotation.y = rec.baseRotY + rec.rotY;
      hint("can't place it there — snapped back");
    }
    setCollidersAt(rec);
    updateSpec(rec);
    setTint(rec, rec === selected ? 'sel' : null);
  }
  refreshJson();
  renderer.domElement.style.cursor = 'crosshair';
  drag = null;
  window.__ghost = null;
  history.commit();
}

function startPlacement(type) {
  if (!canEditWorld()) { hint('Return to live to edit the scene.'); return; }
  if (drag?.placing) cancelPlacement();
  selectedCam = null; history.begin('Add object');
  const onWall = ctxPoint.onWall && type === 'neonSign';
  const spec = { type, position: [ctxPoint.x, onWall ? ctxPoint.y : 0, ctxPoint.z], ...PROP_DEFAULTS[type] };
  if (type === 'neonSign') {
    if (onWall) { spec.wall = true; spec.normal = ctxPoint.normal; }
    else { spec.position[1] = 2.6; spec.facing = player.pos.x < ctxPoint.x ? 'right' : 'left'; }
  }
  const rec = addProp(spec);
  if(onWall){flushToWall(rec,ctxPoint.x);updateSpec(rec);}
  SCENE.environment.props.push(spec);
  select(rec);
  drag = { kind: 'prop', rec, pos: [spec.position[0], spec.position[2]], start: null, startElev: rec.elev, startRot: 0, valid: true, placing: true, lastMouse: null };
  hint(`placing ${type} — click to drop · Q/E rotate · scroll height · Esc cancel`);
  refreshJson();
  revalidate(rec);
}

function commitPlacement() {
  const rec = drag.rec;
  if (drag.kind === 'prop') { setCollidersAt(rec); updateSpec(rec); }
  drag = null; window.__ghost = null; refreshJson(); history.commit(); hint('Placed · Undo to remove');
}
function cancelPlacement() {
  const before = history.pending?.before;
  const rec = drag.rec;
  if (drag.kind === 'prop') removeProp(rec);
  else { SCENE.cameras.splice(SCENE.cameras.indexOf(rec.spec),1); selectedCam=null;syncCameraGizmos();rebuildCamButtons(); }
  if(before){SCENE.cameras=cloneData(before.world.cameras);camIndex=SCENE.cameras.findIndex(c=>c.id===before.cameraId);selectedCam=null;syncCameraGizmos();rebuildCamButtons();}
  drag=null;window.__ghost=null;history.discard();refreshJson();hint('Placement cancelled');
}

let addedCams = 0;
function syncCameraGizmos() {
  for (const rec of [...camRegs]) if (!SCENE.cameras.includes(rec.spec) || rec.spec.type !== 'static') {
    scene.remove(rec.gizmo);
    rec.gizmo.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    camRegs.splice(camRegs.indexOf(rec), 1);
  }
  for (const spec of SCENE.cameras.filter(c => c.type === 'static')) {
    let rec = camRegs.find(c => c.spec === spec);
    if (!rec) {
      const gizmo = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color:0x273735, emissive:0x88c7b1, emissiveIntensity:.7 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(.3,.22,.32),mat);
      const lens = new THREE.Mesh(new THREE.ConeGeometry(.13,.25,12),mat.clone());
      lens.rotation.x = -Math.PI/2; lens.position.z = -.28;
      gizmo.add(body,lens); gizmo.traverse(o => o.userData.cameraId = spec.id);
      scene.add(gizmo); rec = {spec,gizmo}; camRegs.push(rec);
    }
    rec.gizmo.position.fromArray(spec.position);
    const lens = new THREE.PerspectiveCamera(); lens.position.copy(rec.gizmo.position); lens.lookAt(...spec.lookAt);
    rec.gizmo.quaternion.copy(lens.quaternion);
  }
}
function addCamera(x, z) {
  if (!canEditCameras()) return;
  if (drag?.placing) cancelPlacement();
  history.begin('Add camera');
  const y = ctxPoint?.onWall ? ctxPoint.y : 1.6;
  const direction = camera.getWorldDirection(new THREE.Vector3());
  const spec = { id:`camera-${++cameraSequence}`, name:`Cam ${++addedCams}`, type:'static', position:[x,y,z], lookAt:new THREE.Vector3(x,y,z).addScaledVector(direction,8).toArray() };
  SCENE.cameras.push(spec); syncCameraGizmos(); rebuildCamButtons();
  select(null); selectedCam = camRegs.find(r => r.spec === spec);
  drag = {kind:'cam',rec:selectedCam,placing:true,valid:true,startSpec:cloneData(spec)};
  refreshJson(); hint('Placing camera · Q/E rotate · scroll height · click to place · Esc cancel');
}
let menuCamera = null;
function openCameraMenu(spec, x, y) {
  if (!canEditCameras() || spec.type === 'player' || drag) return;
  menuCamera = spec;
  $('camera-menu').style.left = Math.min(x, innerWidth - 175) + 'px';
  $('camera-menu').style.top = Math.min(y, innerHeight - 95) + 'px';
  $('camera-menu').hidden = false;
}
function deleteCamera(spec) {
  if (!canEditCameras() || !spec || spec.type === 'player') return;
  history.run('Delete camera', () => {
    const active = SCENE.cameras[camIndex];
    SCENE.cameras.splice(SCENE.cameras.indexOf(spec),1);
    if (active === spec) { freeRig.pos.copy(camera.position); const e = new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ'); freeRig.yaw=e.y;freeRig.pitch=e.x;camIndex=-1; }
    else camIndex=SCENE.cameras.indexOf(active);
    selectedCam=null;syncCameraGizmos();rebuildCamButtons();refreshJson();
  });
  hint('Camera deleted · Undo to restore');
}

// ---------- mouse wiring ----------
const cv = renderer.domElement;
function openMenuAt(cx, cy) {
  ctxPoint = surfacePoint(cx, cy); if (!ctxPoint) return;
  ctxmenu.querySelectorAll('[data-act]').forEach(el => { el.style.display = ctxPoint.onWall && !['camera','neonSign'].includes(el.dataset.act) ? 'none' : ''; });
  ctxmenu.style.left = Math.min(cx,innerWidth-175)+'px';ctxmenu.style.top=Math.min(cy,innerHeight-240)+'px';ctxmenu.style.display='block';
}
function startLook(e, hit = null) {
  if(recorder || (previewEdit&&!adjustingShot&&controlMode==='camera'))return;
  const spec = editableCameraSpec();
  look={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,button:e.button,hit,moved:false,character:controlMode==='character',spec:controlMode==='camera'&&spec?.type!=='player'?spec:null};
}
cv.addEventListener('mousedown',e=>{
  if (e.button===1) { e.preventDefault();if(canEditWorld()&&!drag)openMenuAt(e.clientX,e.clientY);return; }
  if (e.button===2) { startLook(e,pickAt(e.clientX,e.clientY));return; }
  if (e.button!==0) return;
  if (drag?.placing) { if(drag.valid)commitPlacement();else hint('This object overlaps another object.');return; }
  const hit=pickAt(e.clientX,e.clientY);
  if(hit?.cam && canEditCameras()) {
    select(null);selectedCam=hit.cam;history.begin('Move camera');
    drag={kind:'cam',rec:hit.cam,startSpec:cloneData(hit.cam.spec),valid:true,placing:false};cv.style.cursor='grabbing';
  } else if(hit?.prop && canEditWorld()) {
    selectedCam=null;select(hit.prop);history.begin('Move object');
    drag={kind:'prop',rec:hit.prop,pos:[hit.prop.group.position.x,hit.prop.group.position.z],start:[hit.prop.group.position.x,hit.prop.group.position.z],startElev:hit.prop.elev,startRot:hit.prop.rotY,valid:true,placing:false,lastMouse:[e.clientX,e.clientY]};cv.style.cursor='grabbing';
  } else { select(null);if(camIndex<0)selectedCam=null;startLook(e); }
});
addEventListener('mousemove',e=>{
  if(look) {
    const dx=e.clientX-look.x,dy=e.clientY-look.y;
    if (!dx&&!dy) return;
    if(!look.moved && Math.hypot(e.clientX-look.startX,e.clientY-look.startY)<4)return;
    if(!look.moved) {
      if (look.spec && canEditCameras() && !drag) history.begin('Aim camera');
      look.moved=true;
    }
    if(look.spec) { if(canEditCameras())aimCamera(look.spec,-dx*.0042,-dy*.0042); }
    else {
      const rig=look.character?player:camIndex<0?freeRig:player;
      rig.yaw-=dx*.0042;rig.pitch=THREE.MathUtils.clamp(rig.pitch-dy*.0042,-1.4,1.4);
    }
    look.x=e.clientX;look.y=e.clientY;
  } else if(drag)moveGhost(e);
});
addEventListener('mouseup',e=>{
  if(look && e.button===look.button) {
    if(look.moved && look.spec && history.pending?.label==='Aim camera')history.commit();
    if(!look.moved && e.button===2 && look.hit?.cam && !drag)openCameraMenu(look.hit.cam.spec,e.clientX,e.clientY);
    look=null;return;
  }
  if(e.button===0&&drag&&!drag.placing)finishDrag();
});
cv.addEventListener('wheel',e=>{
  const cam=drag?.kind==='cam'?drag.rec:previewEdit?null:selectedCam;
  if(cam && canEditCameras()) {
    e.preventDefault();if(!drag)history.begin('Raise camera');
    const p=[...cam.spec.position];p[1]=THREE.MathUtils.clamp(p[1]-Math.sign(e.deltaY)*.12,.1,18);translateCamera(cam,p);if(!drag)history.commit();return;
  }
  if(!canEditWorld())return;
  const rec=drag?.kind==='prop'?drag.rec:selected;if(!rec)return;
  e.preventDefault();if(!drag)history.begin('Raise object');elevateProp(rec,-Math.sign(e.deltaY)*.12);setCollidersAt(rec);if(!drag)history.commit();
},{passive:false});
cv.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('click',e=>{
  if(!ctxmenu.contains(e.target))ctxmenu.style.display='none';
  if(!$('camera-menu').contains(e.target))$('camera-menu').hidden=true;
});
ctxmenu.addEventListener('click',e=>{
  const el=e.target.closest('[data-act]');if(!el)return;ctxmenu.style.display='none';
  if(el.dataset.act==='camera')addCamera(ctxPoint.x,ctxPoint.z);else startPlacement(el.dataset.act);
});

// ---------- scene studio ----------
const $ = id => document.getElementById(id);
const cloneData = value => JSON.parse(JSON.stringify(value));
const canEditWorld = () => timeline.mode === 'live' && !recorder && !loadingModels;
const canEditCameras = () => !recorder && !loadingModels && timeline.mode !== 'recording';
const canLoadAssets = () => !recorder && !loadingModels && !drag && !clipDrag && timeline.mode !== 'recording';
function prepareAssetEdit() {
  clearMovementKeys();
  if(timeline.mode === 'playing') timeline.stop();
}
const timeline = new PerformanceTimeline(
  () => ({ worldTime, actors: Object.fromEntries(Object.entries(actors).filter(([, a]) => a.group.visible).map(([name, a]) => [name, { position: a.group.position.toArray(), yaw: a.group.rotation.y, clip: a.clip, clipTime: a.clipTime, layers: cloneData(a.layers) }])) }),
  (a, b, alpha, partial = false) => {
    worldTime = THREE.MathUtils.lerp(a.worldTime, b.worldTime, alpha);
    for (const [name, actor] of Object.entries(actors)) {
      const from = a.actors[name], to = b.actors[name] ?? from;
      if(partial && !from)continue;
      actor.group.visible = !!from && actor.present;
      if (!from) continue;
      actor.group.position.fromArray(from.position).lerp(new THREE.Vector3(...to.position), alpha);
      const delta = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
      actor.group.rotation.y = from.yaw + delta * alpha;
      poseActor(actor, from.clip, from.clip === to.clip ? THREE.MathUtils.lerp(from.clipTime, to.clipTime, alpha) : from.clipTime, from.layers ? blendLayers(from.layers, to.layers ?? from.layers, alpha) : null);
    }
  }
);
function simulate(dt, recordingActors = null) {
  worldTime = recordingActors ? timeline.base.worldTime + timeline.time : worldTime + dt;
  for (const [name, a] of Object.entries(actors)) {
    if (!a.group.visible || (recordingActors && !recordingActors.includes(name))) continue;
    let dx=0,dz=0,speed=a.spec.speed??1.5;
    if (name===controlled && controlMode==='character') {
      const f=Number(!!keys.KeyW)-Number(!!keys.KeyS),side=Number(!!keys.KeyD)-Number(!!keys.KeyA);
      dx=-Math.sin(player.yaw)*f+Math.cos(player.yaw)*side;dz=-Math.cos(player.yaw)*f-Math.sin(player.yaw)*side;
      speed=keys.ShiftLeft||keys.ShiftRight?3.6:1.6;
    } else if(a.spec.path?.length&&!a.gesture&&!a.directed) {
      const target=a.spec.path[a.wp];dx=target[0]-a.group.position.x;dz=target[2]-a.group.position.z;
      if(Math.hypot(dx,dz)<.12){a.wp=(a.wp+1)%a.spec.path.length;dx=dz=0;}
    }
    const intent=new THREE.Vector2(dx,dz);if(intent.lengthSq())intent.normalize().multiplyScalar(speed);
    a.velocity.lerp(intent,1-Math.exp(-dt*(intent.lengthSq()?8:12)));
    if(a.velocity.length()<.015)a.velocity.set(0,0);
    const p=a.group.position,old=p.clone();
    const mx=a.velocity.x*dt,mz=a.velocity.y*dt;
    if(validAt(p.x+mx,p.z,.64,.64,0,1.8))p.x+=mx;else a.velocity.x=0;
    if(validAt(p.x,p.z+mz,.64,.64,0,1.8))p.z+=mz;else a.velocity.y=0;
    const actualSpeed=p.distanceTo(old)/dt;
    if(a.velocity.lengthSq()>.001) {
      const targetYaw=Math.atan2(a.velocity.x,a.velocity.y);
      const delta=Math.atan2(Math.sin(targetYaw-a.group.rotation.y),Math.cos(targetYaw-a.group.rotation.y));
      a.group.rotation.y+=THREE.MathUtils.clamp(delta,-7*dt,7*dt);
    }
    if(actualSpeed>.08) {a.gesture='';animateActor(a,actualSpeed>2.3?a.run:a.walk,dt,Math.max(.3,actualSpeed/(actualSpeed>2.3&&a.run!==a.walk?3.6:1.6)));}
    else if(a.gesture) {
      animateActor(a,a.gesture,dt);
      if(a.clipTime>=a.actions[a.gesture].getClip().duration&&!/dance|sitting/i.test(a.gesture))a.gesture='';
    } else animateActor(a,a.idle,dt);
  }
  if(history.pending?.label==='Move character' && !movementCodes.some(k=>keys[k]) && (!controlled || actors[controlled].velocity.length()<.015))history.commit();
}
function updateEnvironment() {
  for (let i = 0; i < flickering.length; i++) {
    const f = flickering[i];
    const dip = Math.sin(worldTime * 18 + i * 13) > 0.96 && Math.sin(worldTime * 2.3 + i) > 0;
    f.light.intensity = f.base * (dip ? 0.25 : 1);
    f.mat.emissiveIntensity = dip ? 0.4 : 2.2;
  }
  rain?.update(worldTime);
}
function refreshCast() {
  const select = $('actor-select'); select.replaceChildren();
  for (const [name, actor] of Object.entries(actors)) {
    if (!actor.group.visible || !actor.present) continue;
    select.add(new Option(name, name));
  }
  if (!actors[selectedActor]?.group.visible) selectedActor = select.options[0]?.value ?? '';
  select.value = selectedActor;
  $('control-character').replaceChildren(...[...select.options].map(o=>new Option(o.text,o.value)));
  $('control-character').value=selectedActor;
  if(controlMode==='character'){
    controlled=selectedActor || null;
    if(controlled)actors[controlled].directed=true;else controlMode='camera';
  }
  refreshControlMode();
  const gestures = $('gesture-select'); gestures.replaceChildren(new Option('Automatic locomotion', ''));
  for (const clip of Object.keys(actors[selectedActor]?.actions ?? {})) gestures.add(new Option(clip, clip));
  $('control-actor').disabled = !selectedActor;
  $('control-actor').classList.toggle('active', controlled === selectedActor);
  $('control-hint').textContent = controlMode==='character' ? `Controlling ${controlled} · WASD move · Shift run · right-drag steer. Any camera view.` : 'Camera control · right-drag to aim. Select Free to fly with WASD.';
}
$('actor-select').onchange = $('control-character').onchange = e => {
  finishCharacterMovement();
  selectedActor=e.target.value;clearMovementKeys();refreshCast();
};
$('gesture-select').onchange = e => {
  if (!['live', 'recording'].includes(timeline.mode)) { hint('Return to live to direct a character.'); return; }
  const a = actors[selectedActor];
  if (a) {
    const edit=()=>{a.gesture=e.target.value;a.clipTime=0;if(a.layers[a.gesture])a.layers[a.gesture].time=0;};
    if(timeline.mode==='recording')edit();else history.run('Character animation',edit);
  }
};
function clearMovementKeys() { Object.keys(keys).forEach(k=>delete keys[k]); }
function finishCharacterMovement() {
  if(history.pending?.label==='Move character')history.commit();
}
function refreshControlMode() {
  for(const mode of ['camera','character']) {
    const button=$(`mode-${mode}`);
    button.classList.toggle('active',controlMode===mode);
    button.setAttribute('aria-pressed',String(controlMode===mode));
  }
}
function setControlMode(mode) {
  if(drag || look) { hint('Finish placement or the drag before switching controls.');return; }
  if(mode==='character' && (!selectedActor || !['live','recording'].includes(timeline.mode))) {
    hint('Return to live to perform with a character.');return;
  }
  if(mode===controlMode)return;
  finishCharacterMovement();clearMovementKeys();
  controlMode=mode;controlled=mode==='character'?selectedActor:null;
  if(controlled) {
    actors[controlled].directed=true;
    if(SCENE.cameras[camIndex]?.type!=='player')player.yaw=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ').y;
  }
  refreshCast();
}
$('mode-camera').onclick=()=>setControlMode('camera');
$('mode-character').onclick=$('control-actor').onclick=()=>setControlMode('character');
$('free-camera').onclick = enterFreeCamera;
$('camera-delete').onclick = () => { deleteCamera(menuCamera); $('camera-menu').hidden=true; };
const propAssets = [...extraAssets,
  { id: 'streetlamp', name: 'Streetlamp', icon: '♧', detail: 'Practical light' },
  { id: 'neonSign', name: 'Neon sign', icon: '▱', detail: 'Emissive sign' },
  { id: 'dumpster', name: 'Dumpster', icon: '▰', detail: 'Street prop' },
  { id: 'crate', name: 'Wooden crate', icon: '▧', detail: 'Stackable prop' },
  { id: 'puddle', name: 'Puddle', icon: '◌', detail: 'Ground detail' },
];
const sceneAssets=[];
let libraryTab = 'props';
function renderLibrary() {
  const list = $('asset-list'); list.replaceChildren();
  const query = $('asset-search').value.toLowerCase();
  const assets = libraryTab==='characters'?characterAssets:libraryTab==='scenes'?sceneAssets:propAssets.filter(a=>a.category!=='scenes');
  for (const asset of assets.filter(a => `${a.name} ${a.detail} ${(a.tags??[]).join(' ')}`.toLowerCase().includes(query))) {
    const button = document.createElement('button'); button.className = 'asset'; button.dataset.asset = asset.id;
    const icon = document.createElement('span'); icon.className = 'icon'; icon.textContent = asset.icon;
    const name = document.createElement('strong'); name.textContent = asset.name;
    const detail = document.createElement('small'); detail.textContent = asset.detail;
    if (asset.catalog?.poster_key || asset.catalog?.preview_key) {
      const image=document.createElement('img');image.alt='';image.loading='lazy';
      if(libraryNative){
        void libraryNative.invoke('library_preview',{id:asset.id}).then(data=>{if(data){image.src=data;icon.replaceChildren(image);}}).catch(()=>{});
      }else{
        image.src='https://tana.gg/media/'+(asset.catalog.poster_key||asset.catalog.preview_key).split('/').map(encodeURIComponent).join('/');
        image.onerror=()=>icon.textContent=asset.icon;icon.replaceChildren(image);
      }
    }
    button.append(icon, name, detail);
    button.onclick = async () => {
      if (libraryTab === 'characters' ? !canLoadAssets() : !canEditWorld()) {
        hint(libraryTab === 'characters' ? 'Finish the recording or current edit before adding a character.' : 'Return to live before placing objects.'); return;
      }
      if(drag?.placing)cancelPlacement();else if(drag)return;
      button.disabled = true;
      try { await hydrateAsset(asset); } catch(error) { hint(`Could not load ${asset.name}: ${error.message??error}`);button.disabled=false;return; }
      button.disabled=false;
      if(libraryTab==='scenes'){useSceneAsset(asset);return;}
      const [min,max]=worldBounds();
      ctxPoint = { x: THREE.MathUtils.clamp(camera.position.x,min[0]+.5,max[0]-.5), y: 0, z: THREE.MathUtils.clamp(camera.position.z-4,min[1]+.5,max[1]-.5), onWall: false };
      if (libraryTab === 'props') { startPlacement(asset.id); return; }
      button.disabled = true;
      try {
        const result = await rixseScene.dispatch({ type: 'place_asset', payload: { asset_id: asset.id, anchor: 'camera_foreground' } }, 'you');
        if (!result.ok) hint(`Could not add character: ${result.error}`);
      } finally { button.disabled = false; }
    };
    list.appendChild(button);
  }
}
document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => {
  libraryTab = button.dataset.tab;
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === button));
  renderLibrary();
});
$('asset-search').oninput = renderLibrary;
function setSidebarTab(tab,focus=false){
  for(const [name,panel] of [['library','library'],['action','cast-panel']]){
    const active=name===tab,button=$(`${name}-tab`);
    button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
    $(panel).hidden=!active;if(active&&focus)button.focus();
  }
}
for(const tab of ['library','action']){
  $(`${tab}-tab`).onclick=()=>setSidebarTab(tab);
  $(`${tab}-tab`).onkeydown=e=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    e.preventDefault();setSidebarTab(e.key==='Home'?'library':e.key==='End'?'action':tab==='library'?'action':'library',true);
  };
}
$('import-model').onclick = () => {
  if (!canLoadAssets()) { hint('Finish the recording or current edit before importing a model.'); return; }
  prepareAssetEdit();$('model-file').click();
};
$('model-file').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  if (!canLoadAssets()) { e.target.value='';hint('Finish the recording or current edit before importing a model.');return; }
  prepareAssetEdit();
  history.begin('Import model'); const category = libraryTab; loadingModels++; $('import-model').disabled = true;
  try {
    let asset;
    if(libraryNative){
      const loaded=await importModel(file,`import-${++importSequence}`);
      const saved=await libraryNative.invoke('library_import',{name:file.name,category,data:bufferBase64(loaded.buffer)});
      asset=registerSavedAsset(saved);Object.assign(asset,{buffer:loaded.buffer,gltf:loaded.gltf});registerLoadedAsset(asset);
      if(category==='props')await libraryNative.invoke('library_measure',{id:asset.id,footprint:FOOTPRINTS[asset.id],height:PROP_HEIGHTS[asset.id]});
    }else{
      asset=await importModel(file,`import-${++importSequence}`);asset.category=category;registerLoadedAsset(asset);
    }
    renderLibrary(); history.commit(); hint(`${asset.name} is ready in the library.`);
  } catch (error) { history.discard(); hint(`Import failed: ${error.message}`); }
  finally { loadingModels--; $('import-model').disabled = false; e.target.value = ''; }
};
// Metadata is cheap to restore. GLBs are read only when an asset is used.
const personalAssets=new Map();
function registerLoadedAsset(asset){
  if(!importedAssets.some(a=>a.id===asset.id))importedAssets.push(asset);
  if(asset.category==='scenes'){if(!sceneAssets.some(a=>a.id===asset.id))sceneAssets.push(asset);}
  else if(asset.category==='characters'){
    if(!characterAssets.some(a=>a.id===asset.id))characterAssets.push(asset);
  }else{
    const template=normalizedModel(asset.gltf,1.2,false);
    const size=new THREE.Box3().setFromObject(template).getSize(new THREE.Vector3());
    FOOTPRINTS[asset.id]=[Math.max(size.x,.001),Math.max(size.z,.001)];PROP_HEIGHTS[asset.id]=Math.max(size.y,.001);PROP_DEFAULTS[asset.id]={};
    PROP_BUILDERS[asset.id]=(parent,spec)=>{
      const model=normalizedModel(asset.gltf,1.2,false);model.position.add(new THREE.Vector3(...spec.position));parent.add(model);
      collider(spec.position[0],spec.position[2],size.x,size.z);
    };
    if(!propAssets.some(a=>a.id===asset.id))propAssets.push(asset);
  }
}
function registerSavedAsset(saved,render=true){
  let asset=personalAssets.get(saved.id);
  if(!asset){
    asset={...saved,icon:saved.category==='characters'?'◉':saved.category==='scenes'?'▦':'◇',detail:saved.animations.length?`${saved.animations.length} animations · saved`:'Saved to your collection'};
    personalAssets.set(asset.id,asset);
    FOOTPRINTS[asset.id]=saved.footprint??[1.2,1.2];PROP_HEIGHTS[asset.id]=saved.height??1.2;
  }
  const list=asset.category==='characters'?characterAssets:asset.category==='scenes'?sceneAssets:propAssets;
  if(!list.some(a=>a.id===asset.id))list.push(asset);
  if(render)renderLibrary();return asset;
}
function useSceneAsset(asset,author='you'){
  const set=editableScene(asset.gltf,asset.id);
  for(const piece of set.pieces){
    FOOTPRINTS[piece.id]=[Math.max(piece.size.x,.001),Math.max(piece.size.z,.001)];PROP_HEIGHTS[piece.id]=piece.walkable?0:Math.max(piece.size.y,.001);PROP_DEFAULTS[piece.id]={};
    if(!propAssets.some(a=>a.id===piece.id))propAssets.push({id:piece.id,name:piece.name,icon:'▦',detail:`Set piece · ${asset.name}`});
    PROP_BUILDERS[piece.id]=(parent,spec)=>{const model=piece.model.clone(false);model.material=Array.isArray(piece.model.material)?piece.model.material.map(m=>m.clone()):piece.model.material.clone();model.position.add(new THREE.Vector3(...spec.position));parent.add(model);if(!piece.walkable)collider(spec.position[0],spec.position[2],piece.size.x,piece.size.z);};
  }
  history.run('Use scene '+asset.name,()=>{
    for(const rec of [...props])removeProp(rec);
    SCENE.environment.customSet=true;SCENE.environment.bounds=set.bounds;
    SCENE.environment.props=set.pieces.map(piece=>({id:crypto.randomUUID(),type:piece.id,name:piece.name,sourceAsset:asset.id,position:piece.position}));
    for(const spec of SCENE.environment.props){const rec=addProp(spec);setCollidersAt(rec);}
    syncSetBackground();enterFreeCamera();freeRig.pos.set(0,4,Math.min(set.bounds[1][1]-1,12));freeRig.yaw=0;freeRig.pitch=-.25;updateCamera();refreshJson();
  },author);
  hint(`${asset.name} loaded · ${set.pieces.length} editable pieces · Undo restores your previous set`);
}
async function hydrateAsset(asset, countLoading=true){
  if(!asset||!personalAssets.has(asset.id)||asset.gltf)return;
  if(asset.loading)return asset.loading;
  if(countLoading)loadingModels++;
  asset.loading=(async()=>{
    const data=await libraryNative.invoke('library_read',{id:asset.id});
    const loaded=await importModel(modelFile(data,asset.name),asset.id);
    Object.assign(asset,{buffer:loaded.buffer,gltf:loaded.gltf});registerLoadedAsset(asset);
    if(asset.category==='props')await libraryNative.invoke('library_measure',{id:asset.id,footprint:FOOTPRINTS[asset.id],height:PROP_HEIGHTS[asset.id]});
  })().finally(()=>{asset.loading=null;if(countLoading)loadingModels--;});
  return asset.loading;
}
// Timeline clip editing uses metadata copies; recorded frame buffers stay unchanged.
let clipDrag=null, rulerKey='';
const canEditTimeline=()=>!recorder&&!loadingModels&&!drag&&!clipDrag&&!shotDrag&&!pendingShot&&timeline.mode!=='recording';
function timelineViewDuration(){return Math.max(10,Math.ceil((timeline.duration+2)/5)*5);}
function timelineMetrics(){
  const label=parseFloat(getComputedStyle($('timeline')).getPropertyValue('--track-label-width'))||180;
  const width=Math.max($('tracks-scroll').clientWidth,label+timelineViewDuration()*Number($('timeline-zoom').value));
  return {label,width,scale:(width-label)/timelineViewDuration()};
}
function selectClip(id){
  selectedShot=null;adjustingShot=false;syncShotInspector();
  timeline.active=timeline.items.find(i=>i.id===id)??null;
  $('performance-select').value=timeline.active?.id??'';syncClipInspector();updateTrackPlayhead();
}
function canSplitSelection(){
  if(!canEditTimeline())return false;
  const shot=cameraEdit.shots.find(shot=>shot.id===selectedShot);
  const item=shot??timeline.active;if(!item)return false;
  const offset=timeline.time-item.start,length=shot?cameraEdit.length(shot,timeline.duration):timeline.clipLength(item),min=shot ? .1 : 1/item.fps;
  return offset>=min-1e-8&&length-offset>=min-1e-8;
}
function splitAtPlayhead(){
  if(!canSplitSelection()){hint('Select a clip and place the playhead inside it to split.');return;}
  clearMovementKeys();timeline.stop();
  history.run(selectedShot?'Split camera angle':'Split movement layer',()=>{
    if(selectedShot)selectedShot=cameraEdit.split(selectedShot,timeline.time,timeline.duration).id;
    else timeline.splitClip(timeline.active.id,timeline.time);
  });
  refreshPerformances();hint('Clip split at playhead · Undo to join it again');
}
$('split-clip').onclick=splitAtPlayhead;
function syncClipInspector(){
  const item=timeline.active;
  for(const [id,value] of [['clip-name',item?.name??''],['clip-offset',item?.start],['clip-in',item?.inPoint],['clip-out',item?.outPoint??item?.duration]]) {
    $(id).value=typeof value==='number'?Number(value.toFixed(3)):value??'';
  }
  $('clip-in').max=Math.max(0,(item?.duration??0)-1/60);$('clip-out').max=item?.duration??0;
}
function editClip(id,patch,label='Edit performance layer'){
  if(!canEditTimeline())return;
  history.run(label,()=>timeline.updateClip(id,patch));refreshPerformances();
}
for(const [id,key] of [['clip-name','name'],['clip-offset','start'],['clip-in','inPoint'],['clip-out','outPoint']]) {
  $(id).onchange=e=>{
    if(!timeline.active)return;
    const value=key==='name'?e.target.value.trim():Number(e.target.value);
    if(key==='name'&&!value){syncClipInspector();return;}
    editClip(timeline.active.id,{[key]:value});
  };
}
function renderTimelineTracks(){
  const rows=$('track-rows');rows.replaceChildren();
  if(!timeline.items.length){const empty=document.createElement('div');empty.className='empty-tracks';empty.textContent='Record one character, rewind, then record another. Their performances play together.';rows.append(empty);}
  for(const [index,item] of timeline.items.entries()) {
    const row=document.createElement('div');row.className='performance-track';row.dataset.id=item.id;
    const label=document.createElement('div');label.className='track-label';
    const pick=document.createElement('button');pick.className='track-name';pick.textContent=item.actorNames.join(', ');pick.title=item.name;pick.onclick=()=>selectClip(item.id);
    const mute=document.createElement('button');mute.className='track-mute';mute.textContent='M';mute.setAttribute('aria-label',`Mute ${item.name}`);mute.setAttribute('aria-pressed',String(item.muted));mute.onclick=()=>editClip(item.id,{muted:!timeline.items.find(i=>i.id===item.id).muted},'Mute performance layer');
    const del=document.createElement('button');del.className='track-delete';del.textContent='×';del.setAttribute('aria-label',`Delete ${item.name}`);del.onclick=()=>{if(!canEditTimeline())return;history.run('Delete performance layer',()=>timeline.removeClip(item.id));refreshPerformances();};
    label.append(pick,mute,del);
    const lane=document.createElement('div');lane.className='track-lane';lane.onpointerdown=e=>{if(e.target===lane)seekPerformance((e.clientX-lane.getBoundingClientRect().left)/timelineMetrics().scale);};
    const clip=document.createElement('button');clip.className='performance-clip';clip.dataset.clip=item.id;clip.style.setProperty('--clip-hue',String(90+index*47%230));clip.setAttribute('aria-label',`${item.name}, drag to move`);
    const title=document.createElement('span');title.className='clip-title';title.textContent=item.name;
    const start=document.createElement('span');start.className='trim-handle trim-left';start.dataset.trim='in';start.title='Drag to trim the start';
    const end=document.createElement('span');end.className='trim-handle trim-right';end.dataset.trim='out';end.title='Drag to trim the end';
    clip.append(start,title,end);clip.onpointerdown=e=>beginClipDrag(e,item.id);clip.onclick=()=>selectClip(item.id);
    lane.append(clip);row.append(label,lane);rows.append(row);
  }
  syncClipInspector();rulerKey='';updateTrackPlayhead();
}
function beginClipDrag(e,id){
  if(!canEditTimeline()||e.button!==0)return;
  e.preventDefault();clearMovementKeys();timeline.stop();selectClip(id);
  history.begin('Move or trim performance layer');
  const item=timeline.items.find(i=>i.id===id);
  clipDrag={id,original:item,x:e.clientX,scale:timelineMetrics().scale,kind:e.target.dataset.trim??'move',target:e.currentTarget,moved:false};
  e.currentTarget.setPointerCapture(e.pointerId);
}
addEventListener('pointermove',e=>{
  if(!clipDrag)return;
  const d=clipDrag,original=d.original;
  let delta=(e.clientX-d.x)/d.scale;if(!e.altKey)delta=Math.round(delta*10)/10;
  if(Math.abs(e.clientX-d.x)<3&&!d.moved)return;d.moved=true;
  let patch;
  if(d.kind==='in'){
    delta=Math.max(-original.inPoint,-original.start,Math.min(original.outPoint-original.inPoint-1/60,delta));
    patch={start:original.start+delta,inPoint:original.inPoint+delta};
  }else if(d.kind==='out')patch={outPoint:original.outPoint+delta};
  else patch={start:original.start+delta};
  timeline.updateClip(d.id,patch);syncClipInspector();updateTrackPlayhead();
});
function finishClipDrag(cancel=false){
  if(!clipDrag)return;
  const d=clipDrag;clipDrag=null;
  if(cancel){timeline.items=timeline.items.map(i=>i.id===d.id?d.original:i);timeline.active=d.original;timeline.evaluate();history.discard();}
  else if(d.moved)history.commit();else history.discard();
  refreshPerformances();
}
addEventListener('pointerup',()=>finishClipDrag());
addEventListener('pointercancel',()=>finishClipDrag(true));
addEventListener('blur',()=>finishClipDrag(true));
$('timeline-zoom').oninput=()=>{rulerKey='';updateTrackPlayhead();};
$('time-ruler').onpointerdown=e=>{const bounds=e.currentTarget.getBoundingClientRect();seekPerformance((e.clientX-bounds.left)/timelineMetrics().scale);};
function updateTrackPlayhead(){
  const {label,width,scale}=timelineMetrics(),key=`${width}:${label}:${timelineViewDuration()}`;
  $('tracks-stage').style.width=`${width}px`;
  if(key!==rulerKey){
    rulerKey=key;$('time-ruler').replaceChildren();
    const step=scale<50?2:1;
    for(let t=0;t<=timelineViewDuration();t+=step){const mark=document.createElement('span');mark.textContent=`${t}s`;mark.style.left=`${t*scale}px`;$('time-ruler').append(mark);}
  }
  $('timeline-playhead').style.left=`${label+timeline.time*scale}px`;
  const locked=!!recorder||!!loadingModels||timeline.mode==='recording';
  for(const row of $('track-rows').querySelectorAll('.performance-track')){
    const item=timeline.items.find(i=>i.id===row.dataset.id);if(!item)continue;
    row.classList.toggle('selected',item===timeline.active);row.classList.toggle('muted-track',item.muted);
    const clip=row.querySelector('.performance-clip');clip.style.left=`${item.start*scale}px`;clip.style.width=`${Math.max(8,timeline.clipLength(item)*scale)}px`;
    clip.classList.toggle('recording-clip',item===timeline.recording);
    row.querySelectorAll('button').forEach(b=>b.disabled=locked);
  }
  for(const id of ['clip-name','clip-offset','clip-in','clip-out'])$(id).disabled=locked||!timeline.active;
}
function refreshPerformances() {
  syncCameraDuration();renderCameraTrack();
  $('performance-select').replaceChildren(...timeline.items.map(item => new Option(item.name, item.id)));
  $('performance-select').value = timeline.active?.id ?? '';
  renderTimelineTracks();
}
function stopPerformance() {
  clearMovementKeys(); timeline.stop(); Object.values(actors).forEach(a=>a.velocity.set(0,0));
  refreshPerformances(); history.commit(); refreshCast();
}
$('record-performance').onclick = () => {
  if (recorder || loadingModels || drag || clipDrag) { hint('Finish recording, loading, or placing the asset first.'); return; }
  if (timeline.mode === 'recording') { stopPerformance(); return; }
  if (!actors[selectedActor]?.present) { hint('Choose a character first.'); return; }
  if(timeline.time>=300){hint('Move the playhead before the five-minute limit.');return;}
  select(null); clearMovementKeys();
  history.begin('Record performance layer');
  controlled=selectedActor;controlMode='character';
  actors[controlled].directed=true;actors[controlled].velocity.set(0,0);
  if(SCENE.cameras[camIndex]?.type!=='player')player.yaw=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ').y;
  selectedShot=null;adjustingShot=false;syncShotInspector();
  timeline.record(cloneData(SCENE),[selectedActor]); refreshPerformances();refreshCast();
  hint(`Recording ${selectedActor} from ${timeline.time.toFixed(2)}s. Existing layers play along.`);
};
$('performance-select').onchange = e => {
  if (!canEditTimeline()) return;
  selectClip(e.target.value);
};
function seekPerformance(time) {
  if (recorder || drag || clipDrag || loadingModels || timeline.mode==='recording') return;
  clearMovementKeys();timeline.includeActors();timeline.seek(time);adjustingShot=false;refreshCast();
}
$('rewind').onclick = () => seekPerformance(0);
$('scrubber').oninput = e => seekPerformance(Number(e.target.value));
$('play-performance').onclick = () => {
  if (recorder || drag || clipDrag || loadingModels || timeline.mode === 'recording') return;
  clearMovementKeys();timeline.includeActors();
  if (timeline.mode === 'playing') timeline.stop();else {previewEdit=!!cameraEdit.shots.length;adjustingShot=false;timeline.play();}
  refreshCast();
};
$('live-mode').onclick = () => {
  if (recorder || drag || clipDrag || loadingModels || timeline.mode === 'recording') { hint('Finish placement, loading, or recording first.'); return; }
  clearMovementKeys();previewEdit=false;adjustingShot=false;timeline.mode = 'live'; Object.values(actors).forEach(a => {a.group.visible = a.present;a.velocity.set(0,0);}); refreshCast();
};
function updateTimelineUI() {
  const recording = timeline.mode === 'recording', replaying = timeline.mode === 'playing';
  $('undo').disabled = !!recorder || !!loadingModels || recording || (!history.past.length && !history.pending);
  $('redo').disabled = !!recorder || !!loadingModels || recording || !history.future.length;
  $('undo').title = history.past.length ? `Undo: ${history.past.at(-1).label} (⌘/Ctrl Z)` : 'Undo';
  $('redo').title = history.future.length ? `Redo: ${history.future.at(-1).label} (⌘/Ctrl Shift Z)` : 'Redo';
  $('record-performance').textContent = recording ? '■ Stop movement' : '● Record movement';
  $('record-performance').classList.toggle('on', recording);
  $('record-performance').disabled = !!recorder || !!loadingModels;
  $('control-actor').disabled = !selectedActor || !['live', 'recording'].includes(timeline.mode);
  $('mode-character').disabled=$('control-actor').disabled;
  $('controlbar').title=timeline.mode==='paused'||timeline.mode==='playing'?'Recorded movement is locked during replay. Return to live to perform.':'';
  $('gesture-select').disabled = !['live', 'recording'].includes(timeline.mode);
  $('actor-select').disabled=recording; $('control-character').disabled=recording;
  $('performance-select').disabled = recording || !!recorder || !timeline.active;
  $('scrubber').disabled = recording || !!recorder;
  $('rewind').disabled = recording || !!recorder;
  $('play-performance').disabled = recording || !!recorder || !timeline.duration;
  $('split-clip').disabled=!canSplitSelection();
  $('frame-format').disabled=!canEditTimeline();
  $('play-performance').textContent = replaying ? 'Ⅱ' : '▶';
  $('play-performance').setAttribute('aria-label', replaying ? 'Pause scene' : 'Play scene');
  $('live-mode').disabled = recording || !!recorder || timeline.mode === 'live';
  $('scrubber').max = timelineViewDuration(); $('scrubber').value = timeline.time;
  const seconds = timeline.time % 60;
  $('timecode').textContent = `${String(Math.floor(timeline.time / 60)).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`;
  $('duration-label').textContent = timeline.duration.toFixed(1) + 's';
  $('mode-label').textContent = ({ live: 'LIVE SCENE', recording: 'RECORDING PERFORMANCE', paused: 'SCENE PAUSED', playing: 'PLAYING SCENE' })[timeline.mode];
  $('performance-status').textContent = recording ? `Recording ${timeline.recording.actorNames.join(', ')} · other layers play along` : `${selectedActor || 'Choose a character'} · record at ${timeline.time.toFixed(2)}s · rewind to layer another performance`;
  $('track-label').textContent = `${timeline.items.length} layers · ${new Set(timeline.items.flatMap(i=>i.actorNames)).size} characters · 60 fps`;
  updateTrackPlayhead();updateCameraTrack();
}

// Camera editing shares the performance clock and undo history.
function syncCameraDuration(){
  const performanceEnd=Math.max(0,...timeline.items.map(item=>item.start+timeline.clipLength(item)));
  timeline.minimumDuration=cameraEdit.duration(performanceEnd||10);
}
function selectShot(id){
  if(!canEditTimeline())return;
  timeline.stop();selectedCam=null;select(null);selectedShot=id;adjustingShot=false;previewEdit=true;
  const shot=cameraEdit.shots.find(s=>s.id===id);if(shot&&(timeline.time<shot.start||timeline.time>=shot.start+cameraEdit.length(shot,timeline.duration)))timeline.seek(shot.start);
  syncShotInspector();updateCamera();
}
function syncShotInspector(){
  const shot=cameraEdit.shots.find(s=>s.id===selectedShot);
  $('camera-inspector').hidden=!shot;$('clip-inspector').hidden=!!shot;
  if(!shot)return;
  $('shot-camera').replaceChildren(new Option(`${shot.spec.name} · current angle`,'current'),...SCENE.cameras.map(c=>new Option(c.name,c.id)));
  $('shot-start').value=Number(shot.start.toFixed(3));$('shot-start').disabled=false;
  $('shot-length').value=Number(cameraEdit.length(shot,timeline.duration).toFixed(3));
  $('shot-transition').value=shot.transition;$('shot-duration').value=shot.duration;
  $('shot-transition').disabled=shot===cameraEdit.shots[0];$('shot-duration').disabled=shot===cameraEdit.shots[0]||shot.transition==='None';
  $('scene-end').value=Number(timeline.duration.toFixed(3));
  $('shot-delete').disabled=false;
  $('shot-adjust').textContent=adjustingShot?'Done adjusting':'Adjust angle';
}
function changeShot(patch,label='Edit camera shot'){
  if(!canEditTimeline()||!selectedShot)return;
  timeline.stop();history.run(label,()=>{if('start' in patch||'length' in patch)cameraEdit.materialize(timeline.duration);if('start' in patch)cameraEdit.trimStart(selectedShot,patch.start);else cameraEdit.update(selectedShot,patch);});syncCameraDuration();renderCameraTrack();
}
function cameraSpecFor(id){
  if(id==='free'){
    const pos=freeRig.pos.clone(),direction=new THREE.Vector3(0,0,-8).applyEuler(new THREE.Euler(freeRig.pitch,freeRig.yaw,0,'YXZ'));
    return {name:'Free',type:'static',position:pos.toArray(),lookAt:pos.add(direction).toArray(),fov:camera.fov};
  }
  const source=SCENE.cameras.find(c=>c.id===id);if(!source)return null;
  const spec=cloneData(source);
  if(spec.type==='player'){spec.type='track';spec.offset=[Math.sin(player.yaw)*3.4,2.4+player.pitch*1.5,Math.cos(player.yaw)*3.4];}
  if(spec.type==='track')spec.target=selectedActor;
  return spec;
}
function makeCameraDraggable(button,id){
  button.draggable=true;button.title='Drag into the camera track to insert an angle';
  button.ondragstart=e=>{
    if(!canEditTimeline()){e.preventDefault();return;}
    timeline.stop();clearMovementKeys();
    e.dataTransfer.setData('application/x-worldbuilder-camera',id);e.dataTransfer.effectAllowed='copy';
    $('camera-track').classList.add('accept-camera');
  };
  button.ondragend=()=>{$('camera-track').classList.remove('accept-camera');$('camera-lane').classList.remove('drop-camera');};
}
function requestCameraInsert(spec,time=timeline.time){
  if(!canEditTimeline()||!spec)return;
  const length=Number($('insert-angle-length').value),end=timeline.duration;
  let intent;try{intent=cameraEdit.insertion(time,length,end);}catch(error){hint(error.message);return;}
  timeline.stop();clearMovementKeys();
  const request={spec:cloneData(spec),time,length,end};
  if(intent.split){
    pendingShot=request;
    $('shot-insert-description').textContent=`Split “${intent.shot.spec.name}” at ${time.toFixed(2)}s and insert ${length.toFixed(1)}s of “${spec.name}”? Both parts of the original angle will be kept.`;
    $('shot-insert-dialog').showModal();$('cancel-shot-insert').focus();
  }else insertCameraAngle(request,false);
}
function insertCameraAngle(request,split){
  history.run('Insert camera angle',()=>{selectedShot=cameraEdit.insert(request.time,request.length,request.spec,request.end,{split}).id;});
  syncCameraDuration();timeline.seek(request.time);selectShot(selectedShot);renderCameraTrack();
  hint(`Camera angle inserted · ${request.length.toFixed(1)}s · later angles shifted right`);
}
function cancelShotInsert(){pendingShot=null;$('shot-insert-dialog').close();$('record-camera-angle').focus();}
$('cancel-shot-insert').onclick=cancelShotInsert;
$('shot-insert-dialog').addEventListener('cancel',e=>{e.preventDefault();cancelShotInsert();});
$('confirm-shot-insert').onclick=()=>{const request=pendingShot;pendingShot=null;$('shot-insert-dialog').close();if(request)insertCameraAngle(request,true);};
$('record-camera-angle').onclick=$('add-shot').onclick=()=>requestCameraInsert(describeCamera());
$('camera-lane').ondragover=e=>{
  if(!e.dataTransfer.types.includes('application/x-worldbuilder-camera')||!canEditTimeline())return;
  e.preventDefault();e.dataTransfer.dropEffect='copy';const x=Math.max(0,e.clientX-e.currentTarget.getBoundingClientRect().left);
  e.currentTarget.style.setProperty('--drop-x',`${x}px`);e.currentTarget.classList.add('drop-camera');
};
$('camera-lane').ondragleave=e=>{if(!e.currentTarget.contains(e.relatedTarget))e.currentTarget.classList.remove('drop-camera');};
$('camera-lane').ondrop=e=>{
  e.preventDefault();$('camera-track').classList.remove('accept-camera');e.currentTarget.classList.remove('drop-camera');
  const spec=cameraSpecFor(e.dataTransfer.getData('application/x-worldbuilder-camera'));if(!spec)return;
  const time=Math.max(0,Math.round((e.clientX-e.currentTarget.getBoundingClientRect().left)/timelineMetrics().scale*10)/10);
  requestCameraInsert(spec,time);
};
$('preview-edit').onclick=()=>{if(!canEditTimeline())return;previewEdit=true;adjustingShot=false;timeline.stop();syncShotInspector();hint('Camera edit · scrub or play to preview your shots.');};
$('shot-camera').onchange=e=>{
  if(e.target.value==='current')return;
  const spec=cameraSpecFor(e.target.value);if(!spec)return;
  changeShot({spec},'Change shot camera');previewEdit=true;updateCamera();
};
$('shot-length').onchange=e=>changeShot({length:Number(e.target.value)},'Resize camera angle');
for(const id of ['shot-start','shot-length','shot-duration','scene-end'])$(id).addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.target.blur();}});
$('shot-start').onchange=e=>changeShot({start:Number(e.target.value)},'Move camera cut');
$('shot-transition').onchange=e=>changeShot({transition:e.target.value},'Change camera transition');
$('shot-duration').onchange=e=>changeShot({duration:Number(e.target.value)},'Change transition duration');
$('shot-view').onclick=()=>changeShot({spec:describeCamera()},'Use current camera view');
function deleteShot(id){
  if(!canEditTimeline()||!cameraEdit.shots.some(s=>s.id===id))return;
  timeline.stop();
  history.run('Delete camera angle',()=>{cameraEdit.remove(id,timeline.duration);selectedShot=null;});
  if(!cameraEdit.shots.length){previewEdit=false;adjustingShot=false;}
  syncCameraDuration();renderCameraTrack();
}
$('shot-delete').onclick=()=>deleteShot(selectedShot);
$('scene-end').onchange=e=>{
  if(!canEditTimeline())return;
  const end=Number(e.target.value);if(!Number.isFinite(end))return;
  timeline.stop();history.run('Change scene length',()=>{
    cameraEdit.materialize(timeline.duration);
    const last=cameraEdit.shots.at(-1);
    if(last)cameraEdit.update(last.id,{length:Math.max(.1,Math.min(300,end))-last.start});
  });syncCameraDuration();renderCameraTrack();
  if(timeline.duration>end+.01)hint('The scene ends after its last performance or camera cut. Trim those to shorten it further.');
};
$('shot-adjust').onclick=()=>{
  if(!canEditTimeline())return;
  if(adjustingShot){adjustingShot=false;syncShotInspector();return;}
  previewEdit=true;controlMode='camera';controlled=null;adjustingShot=true;
  const shot=cameraEdit.shots.find(s=>s.id===selectedShot);timeline.seek(shot.start);updateCamera();selectedCam=null;select(null);refreshCast();syncShotInspector();
  hint('Right-drag to aim this shot on its fixed position · Q / E to rotate · Done adjusting when ready.');
};
function renderCameraTrack(){
  const lane=$('camera-lane');lane.replaceChildren();
  for(const [i,shot] of cameraEdit.shots.entries()){
    const button=document.createElement('button');button.className='camera-clip';button.dataset.shot=shot.id;
    const title=document.createElement('span');title.className='clip-title';title.textContent=shot.spec.name;
    const effect=document.createElement('span');effect.className='camera-effect';effect.textContent=i&&shot.transition!=='None'?`${shot.transition} ${Math.min(shot.duration,cameraEdit.length(shot,timeline.duration)).toFixed(1)}s`:'';
    button.append(title,effect);
    {const left=document.createElement('span');left.className='trim-handle trim-left';left.dataset.edge='start';button.append(left);}
    const right=document.createElement('span');right.className='trim-handle trim-right';right.dataset.edge='end';button.append(right);
    button.setAttribute('aria-label',`${shot.spec.name} camera at ${shot.start.toFixed(1)} seconds`);
    button.onpointerdown=e=>{
      if(e.button!==0||!canEditTimeline())return;e.preventDefault();selectShot(shot.id);
      history.begin('Move camera cut');shotDrag={id:shot.id,x:e.clientX,scale:timelineMetrics().scale,edge:e.target.dataset.edge??'move',original:cloneData(cameraEdit.shots),length:cameraEdit.length(shot,timeline.duration),end:cameraEdit.end,originalDuration:timeline.duration,moved:false};button.setPointerCapture(e.pointerId);
    };
    const remove=document.createElement('button');remove.className='remove-camera-angle';remove.dataset.removeShot=shot.id;remove.textContent='×';remove.setAttribute('aria-label',`Remove ${shot.spec.name} camera angle`);remove.onclick=()=>deleteShot(shot.id);
    button.oncontextmenu=e=>{e.preventDefault();selectShot(shot.id);$('shot-delete').focus();};
    lane.append(button,remove);
  }
  if(!cameraEdit.shots.length){const empty=document.createElement('span');empty.className='empty-camera-track';empty.textContent='Drag a camera here, or choose a view and Record Camera Angle';lane.append(empty);}
  syncShotInspector();updateCameraTrack();
}
$('camera-lane').onpointerdown=e=>{if(e.target===e.currentTarget)seekPerformance((e.clientX-e.currentTarget.getBoundingClientRect().left)/timelineMetrics().scale);};
addEventListener('pointermove',e=>{
  if(!shotDrag)return;const d=shotDrag,index=d.original.findIndex(s=>s.id===d.id),original=d.original[index];
  if(Math.abs(e.clientX-d.x)<3&&!d.moved)return;if(!d.moved)cameraEdit.materialize(d.originalDuration);d.moved=true;
  let delta=(e.clientX-d.x)/d.scale;if(!e.altKey)delta=Math.round(delta*10)/10;
  // Re-evaluate from the gesture's baseline so reversing a drag never accumulates errors.
  cameraEdit.shots=cloneData(d.original);cameraEdit.materialize(d.originalDuration);
  if(d.edge==='end'&&d.original[index+1])cameraEdit.trimStart(d.original[index+1].id,original.start+d.length+delta);
  else if(d.edge==='end')cameraEdit.update(d.id,{length:d.length+delta});
  else if(d.edge==='start')cameraEdit.trimStart(d.id,original.start+delta);
  else cameraEdit.update(d.id,{start:original.start+delta});
  syncCameraDuration();syncShotInspector();updateCameraTrack();
});
function finishShotDrag(cancel=false){
  if(!shotDrag)return;const d=shotDrag;shotDrag=null;
  if(cancel){cameraEdit.shots=d.original;cameraEdit.end=d.end;history.discard();}
  else if(d.moved)history.commit();else history.discard();
  syncCameraDuration();renderCameraTrack();
}
addEventListener('pointerup',()=>finishShotDrag());addEventListener('pointercancel',()=>finishShotDrag(true));addEventListener('blur',()=>finishShotDrag(true));
function updateCameraTrack(){
  updateCamButtons();
  const {scale}=timelineMetrics(),sample=cameraEdit.sample(timeline.time,timeline.duration),locked=!!recorder||!!loadingModels||!!pendingShot||timeline.mode==='recording';
  $('preview-edit').textContent=previewEdit?`${sample?.shot.spec.name??'Camera'} · Edit`:'Camera edit';$('preview-edit').classList.toggle('active',previewEdit);
  for(const [i,shot] of cameraEdit.shots.entries()){
    const button=$('camera-lane').querySelector(`[data-shot="${shot.id}"]`);if(!button)continue;
    button.style.left=`${shot.start*scale}px`;button.style.width=`${Math.max(8,(cameraEdit.length(shot,timeline.duration))*scale)}px`;
    const remove=$('camera-lane').querySelector(`[data-remove-shot="${shot.id}"]`);remove.style.left=`${(shot.start+cameraEdit.length(shot,timeline.duration))*scale-23}px`;remove.disabled=locked;
    button.classList.toggle('selected',shot.id===selectedShot);button.classList.toggle('playing',previewEdit&&sample?.shot===shot);button.disabled=locked;
  }
  for(const id of ['add-shot','record-camera-angle','insert-angle-length','preview-edit','shot-camera','shot-view','shot-adjust','scene-end','shot-length'])$(id).disabled=locked;
  $('shot-start').disabled=locked;
  $('shot-transition').disabled=locked||selectedShot===cameraEdit.shots[0]?.id;
  $('shot-duration').disabled=$('shot-transition').disabled||cameraEdit.shots.find(s=>s.id===selectedShot)?.transition==='None';
  $('shot-delete').disabled=locked||!selectedShot;
}

// ---------- camera footage & export ----------
const recBtn = $('rec'), recTime = $('rectime'), playback = $('playback');
window.__exports = [];
const footage = [];
let recorder = null, cancelledExport=false;
function describeCamera() {
  updateCamera();
  const spec = cloneData((previewEdit?cameraEdit.sample(timeline.time,timeline.duration)?.shot.spec:SCENE.cameras[camIndex]) ?? {name:'Free',type:'static'});
  if(spec.type==='track'&&!previewEdit)spec.target=selectedActor;
  if(spec.type!=='track') {spec.type='static';spec.position=camera.position.toArray();spec.lookAt=camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(8)).toArray();}
  return {...spec,fov:camera.fov};
}
function toggleRec() {
  if(recorder){cancelledExport=true;if(recorder.state==='recording')recorder.stop();timeline.stop();return;}
  if(timeline.mode==='recording'||loadingModels||drag||clipDrag||shotDrag){hint('Finish the current recording or edit before exporting.');return;}
  if(!window.MediaRecorder||!renderer.domElement.captureStream){hint('Video export is unavailable in this browser. Use Chrome or Edge.');return;}
  if(!cameraEdit.shots.length){hint('Add a camera angle before exporting video.');return;}
  timeline.stop();clearMovementKeys();
  for(const option of $('export-format').options)option.disabled=!exportMime(option.value);
  if(!exportMime(videoSettings.format))videoSettings.format=[...$('export-format').options].find(option=>!option.disabled)?.value;
  if(!videoSettings.format){hint('No supported video format in this browser.');return;}
  $('export-format').value=videoSettings.format;$('export-quality').value=videoSettings.quality;$('export-aspect').value=videoSettings.aspect;
  $('export-format-note').hidden=!!exportMime('mp4');updateExportSize();$('export-dialog').showModal();
}
function exportMime(format){
  const candidates=format==='mp4'?['video/mp4;codecs=avc1.42E033','video/mp4']:['video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm'];
  return candidates.find(mime=>window.MediaRecorder?.isTypeSupported(mime));
}
function exportDimensions(){
  const quality=videoQualities[$('export-quality').value]??videoQualities.standard;
  const wide=quality.height*16/9;
  return {width:videoSettings.aspect==='portrait'?quality.height:wide,height:videoSettings.aspect==='portrait'?wide:quality.height,bitrate:quality.bitrate};
}
function updateExportSize(){const size=exportDimensions();$('export-size').textContent=`${size.width} × ${size.height} · 30 fps`;}
function setFrameFormat(aspect){
  if(!['landscape','portrait'].includes(aspect)||!canEditTimeline())return;
  history.run('Change video frame',()=>{videoSettings.aspect=aspect;$('frame-format').value=aspect;$('export-aspect').value=aspect;resizeViewport();});
  updateExportSize();
}
$('frame-format').onchange=e=>setFrameFormat(e.target.value);
$('export-aspect').onchange=e=>setFrameFormat(e.target.value);
$('export-quality').onchange=updateExportSize;
$('cancel-export-settings').onclick=()=>$('export-dialog').close();
$('start-export').onclick=()=>{
  const format=$('export-format').value,quality=$('export-quality').value,mime=exportMime(format);
  if(!mime){hint('This video format is unavailable in your browser.');return;}
  const size=exportDimensions();videoSettings.format=format;videoSettings.quality=quality;$('export-dialog').close();
  startVideoExport(mime,size);
};
function startVideoExport(mime,size){
  resizeViewport();clearMovementKeys();select(null);selectedCam=null;timeline.stop();timeline.base??=timeline.capture();timeline.includeActors();syncCameraDuration();
  renderer.setPixelRatio(1);renderer.setSize(size.width,size.height,false);
  previewEdit=true;adjustingShot=false;timeline.seek(0);updateEnvironment();updateCamera();
  const meta={export:footage.length+1,secs:timeline.duration,format:videoSettings.format,quality:videoSettings.quality,aspect:videoSettings.aspect,width:size.width,height:size.height,bitrate:size.bitrate,fps:30,composition:timeline.items.map(({frames,world,...clip})=>cloneData(clip)),cameras:cloneData(cameraEdit.shots)};
  meta.file=`scene-video-${meta.export}.${mime.startsWith('video/mp4')?'mp4':'webm'}`;
  let stream;
  try{stream=renderer.domElement.captureStream(30);recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:size.bitrate});}
  catch(error){stream?.getTracks().forEach(t=>t.stop());recorder=null;resizeViewport();hint(`Export failed: ${error.message}`);return;}
  cancelledExport=false;const chunks=[];
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  recorder.onerror=()=>{cancelledExport=true;hint('The browser could not finish the video export.');};
  recorder.onstop=()=>{
    stream.getTracks().forEach(t=>t.stop());recorder=null;recBtn.classList.remove('on');recBtn.textContent='Export video ↗';recTime.textContent='';resizeViewport();
    if(cancelledExport){hint('Export cancelled. Your scene edit is unchanged.');return;}
    const blob=new Blob(chunks,{type:mime}),url=URL.createObjectURL(blob);meta.bytes=blob.size;
    footage.push({meta,blob,url});window.__exports.push(meta);
    $('download-video').href=url;$('download-video').download=meta.file;openPreview(url);
    hint('Scene video is ready. Download it from the preview.');
  };
  try{camRegs.forEach(c=>c.gizmo.visible=false);renderScene();recorder.start(100);}
  catch(error){stream.getTracks().forEach(t=>t.stop());recorder=null;resizeViewport();hint(`Export failed: ${error.message}`);return;}
  accumulator=0;previousTime=performance.now();timeline.play();
  recBtn.classList.add('on');recBtn.textContent='Cancel export';
}
recBtn.onclick = toggleRec;
let previewOpener=null;
function openPreview(url) {
  clearMovementKeys();previewOpener=document.activeElement;
  playback.src=url;$('preview-window').hidden=false;$('close-playback').focus();
  playback.play().catch(()=>{});
}
function closePreview() {
  playback.pause();$('preview-window').hidden=true;
  if(previewOpener?.isConnected)previewOpener.focus();
  previewOpener=null;
}
$('close-playback').onclick=closePreview;
$('export-all').onclick = async () => {
  if (recorder || timeline.mode === 'recording') { hint('Stop recording before exporting.'); return; }
  const button = $('export-all'); button.disabled = true;
  try {
    const files = {
      'scene.json': strToU8(JSON.stringify(SCENE, null, 2)),
      'performances.json': strToU8(JSON.stringify({ version: 2, base: timeline.base, duration: timeline.duration, performances: timeline.items })),
      'cameras.json': strToU8(JSON.stringify({version:1,end:timeline.duration,aspect:videoSettings.aspect,shots:cameraEdit.shots},null,2)),
      'manifest.json': strToU8(JSON.stringify({ version: 2, videos: window.__exports, assets: characterAssets.filter(a => a.url).map(a => ({ id: a.id, name: a.name, category: 'characters', file: a.url.replace('./', '') })).concat(importedAssets.map(a => ({ id: a.id, name: a.name, category: a.category, file: `assets/${a.id}.glb` }))) }, null, 2)),
      'README.txt': strToU8('Tana Studio scene export\nVideos are in footage/. Import these into your preferred video editor.\nperformances.json version 2 contains the shared baseline and 60 fps character clips with start times, trim points, and mute states. Videos render the entire scene with the camera edit in cameras.json.\nScene JSON and performance data are for future project loading; this prototype has no project import yet.\nNo audio is recorded.\n'),
    };
    await Promise.all(['performer.glb', 'robot.glb', 'ATTRIBUTION.md'].map(async name => {
      const response = await fetch(`./assets/${name}`);
      if (!response.ok) throw new Error(`Could not include ${name}`);
      files[`assets/${name}`] = new Uint8Array(await response.arrayBuffer());
    }));
    for (const take of footage) files[`footage/${take.meta.file}`] = new Uint8Array(await take.blob.arrayBuffer());
    for (const asset of importedAssets) {
      files[`assets/${asset.id}.glb`] = new Uint8Array(asset.buffer);
      if(asset.catalog)files[`assets/${asset.id}.source.json`]=strToU8(JSON.stringify(asset.catalog,null,2));
    }
    const zipped = zipSync(files, { level: 0 });
    const url = URL.createObjectURL(new Blob([zipped], { type: 'application/zip' }));
    const a = document.createElement('a'); a.href = url; a.download = 'studio-scene.zip'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000); hint(`Exported ${footage.length} scene videos and ${timeline.items.length} performances. Unzip to a folder.`);
  } catch (error) { hint(`Export failed: ${error.message}`); }
  finally { button.disabled = false; }
};

// ---------- global edit history ----------
function captureEditState() {
  return {
    world:cloneData(SCENE), worldTime, snapOn,
    frameFormat:videoSettings.aspect,
    cameraEdit:cloneData({shots:cameraEdit.shots,end:cameraEdit.end}),selectedShot,previewEdit,
    actors:Object.fromEntries(Object.entries(actors).filter(([,a])=>a.present).map(([name,a])=>[name,{
      position:a.group.position.toArray(),yaw:a.group.rotation.y,clip:a.clip,clipTime:a.clipTime,layers:cloneData(a.layers),
      velocity:a.velocity.toArray(),directed:a.directed,gesture:a.gesture,wp:a.wp,visible:a.group.visible
    }])),
    cameraId:SCENE.cameras[camIndex]?.id??null, free:{position:freeRig.pos.toArray(),yaw:freeRig.yaw,pitch:freeRig.pitch},
    player:{yaw:player.yaw,pitch:player.pitch}, controlled, controlMode, selectedActor,
    performances:[...timeline.items], active:timeline.active, timelineBase:timeline.base, mode:timeline.mode,time:timeline.time,
    imports:[...importedAssets], props:[...propAssets], characters:[...characterAssets]
  };
}
function restoreEditState(state) {
  videoSettings.aspect=state.frameFormat??'landscape';$('frame-format').value=videoSettings.aspect;$('export-aspect').value=videoSettings.aspect;resizeViewport();
  Object.keys(keys).forEach(k=>delete keys[k]);look=null;drag=null;selectedCam=null;select(null);window.__ghost=null;
  $('camera-menu').hidden=true;ctxmenu.style.display='none';
  for(const rec of [...props])removeProp(rec);
  SCENE.environment=cloneData(state.world.environment);syncSetBackground();
  SCENE.environment.props=cloneData(state.world.environment.props);
  SCENE.environment.props.forEach(spec=>{const rec=addProp(spec);setCollidersAt(rec);});
  SCENE.cameras=cloneData(state.world.cameras);SCENE.characters=cloneData(state.world.characters);
  for(const [name,a] of Object.entries(actors)) {
    const data=state.actors[name];a.present=!!data;a.group.visible=!!data?.visible;
    if(!data)continue;
    a.spec=SCENE.characters.find(c=>c.name===name);a.group.position.fromArray(data.position);a.group.rotation.y=data.yaw;
    a.velocity.fromArray(data.velocity);a.directed=data.directed;a.gesture=data.gesture;a.wp=data.wp;
    poseActor(a,data.clip,data.clipTime,data.layers);
  }
  worldTime=state.worldTime;snapOn=state.snapOn;controlled=state.controlled;controlMode=state.controlMode??(controlled?'character':'camera');selectedActor=state.selectedActor;
  freeRig.pos.fromArray(state.free.position);freeRig.yaw=state.free.yaw;freeRig.pitch=state.free.pitch;
  Object.assign(player,state.player);camIndex=SCENE.cameras.findIndex(c=>c.id===state.cameraId);
  importedAssets.splice(0,importedAssets.length,...state.imports);propAssets.splice(0,propAssets.length,...state.props);characterAssets.splice(0,characterAssets.length,...state.characters);
  // Undo affects scene edits; saved collection files remain available.
  for(const asset of personalAssets.values()){registerSavedAsset(asset,false);if(asset.gltf)registerLoadedAsset(asset);}
  timeline.items=[...state.performances];timeline.active=state.active;timeline.base=state.timelineBase;timeline.recording=null;timeline.time=state.time;
  timeline.mode=state.mode==='playing'?'paused':state.mode;
  cameraEdit.shots=cloneData(state.cameraEdit.shots);cameraEdit.end=state.cameraEdit.end;selectedShot=state.selectedShot;previewEdit=state.previewEdit;adjustingShot=false;
  closePreview();
  syncCameraGizmos();selectedCam=camRegs.find(r=>r.spec===SCENE.cameras[camIndex])??null;rebuildCamButtons();refreshCast();renderLibrary();refreshPerformances();refreshJson();updateCamera();
}
const history=new EditHistory(captureEditState,restoreEditState);
function undoRedo(redo=false) {
  if(recorder||loadingModels||clipDrag||timeline.mode==='recording'){hint('Stop recording or wait for the model before undoing.');return;}
  if(drag?.placing){cancelPlacement();return;}
  if(drag||look){hint('Finish the drag before undoing.');return;}
  const label=redo?history.redo():history.undo();
  if(label)hint(`${redo?'Redid':'Undid'}: ${label}`);
}
$('undo').onclick=()=>undoRedo();$('redo').onclick=()=>undoRedo(true);
// ---------- scene.json panel ----------
refreshJson();
window.__scene = SCENE;
window.__colliders = colliders;
window.__ghost = null;
window.__player = player;
window.__dragState = () => drag && { kind: drag.kind, placing: drag.placing, valid: drag.valid };
window.__surfacePoint = surfacePoint;
window.__project = (x, y, z) => {
  const v = new THREE.Vector3(x, y, z).project(camera);
  const rect=renderer.domElement.getBoundingClientRect();
  return [rect.left+(v.x+1)/2*rect.width,rect.top+(-v.y+1)/2*rect.height];
};

// ---------- loop ----------
await actorReady.catch(error => { hint('Character could not load. Try adding another from the library.'); console.error(error); });
syncCameraGizmos();
updateCamera();cameraEdit.add(0,describeCamera());
refreshCast();
renderLibrary();
refreshPerformances();
window.__studio = { cameraEdit, get previewEdit(){return previewEdit;}, transitions, renderer, scene, renderScene, timeline, actors, history, camera, freeRig, get camIndex() { return camIndex; }, get worldTime() { return worldTime; }, get controlled() { return controlled; }, get controlMode() { return controlMode; }, get ready() { return Object.keys(actors).length > 0; } };
let previousTime = performance.now();
let accumulator = 0;
function renderScene(){
  const sample=previewEdit?cameraEdit.sample(timeline.time,timeline.duration):null;
  if(previewEdit&&!sample){renderer.setClearColor(0x000000,1);renderer.clear();return;}
  if(sample?.previous)poseShot(outgoingCamera,sample.previous.spec);
  transitions.render(scene,camera,sample?.previous?outgoingCamera:null,sample?.transition,sample?.progress);
}
function tick() {
  const now = performance.now();
  const dt = Math.min((now - previousTime) / 1000, 0.1);
  previousTime = now;
  let finishExport=false;
  movePlayer(dt);
  accumulator += dt;
  while (accumulator >= 1 / 60) {
    const wasPlaying = timeline.mode === 'playing';
    timeline.step(1 / 60, simulate);
    accumulator -= 1 / 60;
    if (wasPlaying && timeline.mode === 'paused' && recorder?.state === 'recording') finishExport=true;
    if (timeline.mode === 'recording' && timeline.time >= 300) { stopPerformance(); hint('Performance saved at the five-minute limit.'); }
  }
  updateEnvironment();
  updateCamera(dt);
  camRegs.forEach(c => c.gizmo.visible = !recorder && !previewEdit && SCENE.cameras[camIndex] !== c.spec);
  renderScene();
  if(recorder)recTime.textContent=`${Math.round(100*timeline.time/timeline.duration)}%`;
  if(finishExport&&recorder?.state==='recording')recorder.stop();
  updateTimelineUI();
  requestAnimationFrame(tick);
}
tick();

function resizeViewport(){
  const rect=viewport.getBoundingClientRect(),aspect=frameAspect();
  const width=Math.max(1,Math.min(rect.width,rect.height*aspect)),height=width/aspect;
  renderer.domElement.style.width=`${width}px`;renderer.domElement.style.height=`${height}px`;
  if(recorder)return; // Fit the visible frame while keeping the export resolution and lens stable.
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(previewPixelRatio);
  renderer.setSize(width,height,false);
}
new ResizeObserver(resizeViewport).observe(viewport);
resizeViewport();

// The agent calls engine operations, never evaluates generated JavaScript.
function agentAnchors() {
  updateCamera();
  const forward = camera.getWorldDirection(new THREE.Vector3()); forward.y = 0;
  if (forward.lengthSq() < .01) forward.set(0, 0, -1); else forward.normalize();
  const foreground = camera.position.clone().addScaledVector(forward, 4);
  const anchors = {
    camera_foreground: { name: 'In front of the current camera', position: [THREE.MathUtils.clamp(foreground.x,worldBounds()[0][0]+.7,worldBounds()[1][0]-.7),0,THREE.MathUtils.clamp(foreground.z,worldBounds()[0][1]+.7,worldBounds()[1][1]-.7)] },
    alley_center: { name: 'Middle of the alley', position: [0, 0, -16] },
    left_wall: { name: 'Near the left wall', position: [-3.6, 0, -14] },
    right_wall: { name: 'Near the right wall', position: [3.6, 0, -14] },
  };
  if(SCENE.environment.customSet){delete anchors.alley_center;delete anchors.left_wall;delete anchors.right_wall;anchors.scene_center={name:'Middle of the set',position:[0,0,0]};}
  const actor = actors[selectedActor];
  if (actor?.present) anchors.near_character = { name: `Near ${selectedActor}`, position: [actor.group.position.x + 1.2, 0, actor.group.position.z + .8] };
  for (const rec of props) anchors[`object:${rec.spec.id}`] = { name: `At ${rec.spec.type}`, position: rec.group.position.toArray() };
  return anchors;
}
function agentLibrary() {
  return [...propAssets.map(asset => ({ id: asset.id, name: asset.name, category: 'props', description: asset.detail, footprint: FOOTPRINTS[asset.id], height: PROP_HEIGHTS[asset.id] ?? .7 })),
    ...sceneAssets.map(asset=>({id:asset.id,name:asset.name,category:'scenes',description:asset.detail})),
    ...characterAssets.map(asset => ({ id: asset.id, name: asset.name, category: 'characters', description: asset.detail, footprint: [.64, .64], height: 1.85 }))];
}
const sceneSnapshot = () => cloneData({
  scene: SCENE,
  objects: props.map(rec => ({ id: rec.spec.id, assetId: rec.spec.type, position: rec.group.position.toArray(), rotationY: rec.rotY })),
  characters: Object.entries(actors).filter(([, a]) => a.present).map(([name, a]) => ({ name, assetId: a.spec.assetId, position: a.group.position.toArray(), rotationY: a.group.rotation.y })),
  reservedCharacterNames: Object.keys(actors),
  library: agentLibrary(), anchors: agentAnchors(),
  coordinates: { units: 'metres', axes: 'X right; Y up; negative Z forward', min: [worldBounds()[0][0],0,worldBounds()[0][1]], max: [worldBounds()[1][0],9,worldBounds()[1][1]] },
  view: { name: SCENE.cameras[camIndex]?.name ?? 'Free camera', position: camera.position.toArray(), direction: camera.getWorldDirection(new THREE.Vector3()).toArray(), right: new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).toArray() },
  cameras: cameraEdit.shots,
  performances: timeline.items.map(({frames,world,...clip}) => clip),
  duration: timeline.duration, time: timeline.time, mode: timeline.mode, videoFrame: videoSettings.aspect,
});
function agentClear(asset, rotation, ignore = []) {
  const [w, d] = asset.footprint ?? [0, 0], c = Math.abs(Math.cos(rotation)), s = Math.abs(Math.sin(rotation));
  return ([x, y, z]) => y >= 0 && y <= 9 && validAt(x, z, w*c+d*s, w*s+d*c, y, asset.height, ignore)
    && (asset.height === 0 || !Object.values(actors).some(actor => actor.present && y < actor.group.position.y + 1.85 && y + asset.height > actor.group.position.y && Math.abs(x-actor.group.position.x) < (w*c+d*s)/2+.32 && Math.abs(z-actor.group.position.z) < (w*s+d*c)/2+.32));
}
function agentEditReady() {
  if (!window.__studio.ready || recorder || loadingModels || drag || look || clipDrag || shotDrag || pendingShot || history.pending || timeline.mode === 'recording') throw new Error('Finish the current recording, placement or edit before changing the scene.');
}
const rixseScene = createSceneBridge({
  prepare: async action => {
    if(['place_asset','use_scene'].includes(action.type)){agentEditReady();await hydrateAsset(personalAssets.get(action.payload?.asset_id));}
  },
  read: sceneSnapshot,
  clear: (asset, rotation, ignoreId) => agentClear(asset, rotation, props.find(rec => rec.spec.id === ignoreId)?.colliders ?? []),
  project: async ({ type, asset, record }, author) => {
    agentEditReady(); prepareAssetEdit();
    if(type==='use_scene'){useSceneAsset(sceneAssets.find(a=>a.id===asset.id),author);return;}
    const label = `${author === 'agent' ? 'Agent: ' : ''}${type === 'place_asset' ? 'add ' + asset.name : type === 'move_prop' ? 'move object' : 'delete object'}`;
    if (type === 'delete_prop') {
      const rec = props.find(p => p.spec.id === record.id);
      history.run(label, () => { removeProp(rec); refreshJson(); }, author); return;
    }
    if (type === 'move_prop') {
      const rec = props.find(p => p.spec.id === record.id);
      history.run(label, () => { rec.group.position.fromArray(record.position); rec.elev = record.position[1]; rec.rotY = record.rotationY; rec.group.rotation.y = rec.baseRotY + rec.rotY; updateSpec(rec); setCollidersAt(rec); refreshJson(); }, author); return;
    }
    if (asset.category === 'characters') {
      history.begin(label, author); loadingModels++;
      try {
        const spec = { id: record.id, name: record.name, assetId: asset.id, position: record.position, speed: 1.5 };
        const actor = await createActor(characterAssets.find(a => a.id === asset.id), spec);
        actor.group.rotation.y = record.rotationY; actors[spec.name] = actor; scene.add(actor.group); SCENE.characters.push(spec);
        selectedActor = spec.name; timeline.includeActors(); refreshCast(); refreshJson(); history.commit();
      } catch (error) { history.discard(); throw error; } finally { loadingModels--; }
    } else {
      const spec = { ...PROP_DEFAULTS[asset.id], id: record.id, type: asset.id, position: record.position, rotationY: record.rotationY };
      history.run(label, () => { const added = addProp(spec); SCENE.environment.props.push(spec); setCollidersAt(added); refreshJson(); }, author);
    }
    hint(`${asset.name} added${author === 'agent' ? ' by the agent' : ''} · Undo to remove`);
  },
});
window.__studio.rixse = rixseScene;
window.__studio.useSceneAsset=useSceneAsset;
window.studioContext = () => {
  const { coordinates, view, cameras, performances, duration, time, mode, videoFrame } = sceneSnapshot();
  const rixse = rixseScene.encode();
  const selection = {
    object: selected ? rixseScene.wire.handle('object', selected.spec.id) : null,
    anchor: selected ? rixseScene.wire.handle('anchor', `object:${selected.spec.id}`) : null,
    character: selectedActor ? rixseScene.wire.handle('character', selectedActor) : null,
  };
  view.objectScreenPositions = props.flatMap(rec => {
    const center = new THREE.Box3().setFromObject(rec.group).getCenter(new THREE.Vector3()).project(camera);
    return center.z >= -1 && center.z <= 1 && Math.abs(center.x) <= 1 && Math.abs(center.y) <= 1
      ? [{ object: rixseScene.wire.handle('object', rec.spec.id), x: (center.x + 1)/2, y: (1-center.y)/2 }] : [];
  });
  return { rixse, selection, coordinates, view, cameras, performances, duration, time, mode, videoFrame };
};
window.studioViewImage = () => {
  // Read immediately after rendering, before WebGL discards its back buffer.
  // This is the current frame (including camera transitions), never the desktop.
  renderScene();
  const source = renderer.domElement, image = document.createElement('canvas');
  const scale = Math.min(1, 1024 / Math.max(source.width, source.height));
  image.width = Math.max(1, Math.round(source.width * scale)); image.height = Math.max(1, Math.round(source.height * scale));
  image.getContext('2d').drawImage(source, 0, 0, image.width, image.height);
  return image.toDataURL('image/jpeg', .8);
};
window.studioAgent = {
  async executeTool(name, args = {}) {
    try {
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
      if (name === 'get_scene') return { ok: true, ...window.studioContext() };
      if (name === 'list_library') return { ok: true, ...rixseScene.encode() };
      if (name === 'apply_action') {
        agentEditReady();
        if (typeof args.payload !== 'string' || args.payload.length > 16000) throw new Error('Provide a JSON action payload.');
        return await rixseScene.dispatch({ type: args.type, payload: JSON.parse(args.payload) }, 'agent');
      }
      if (name === 'find_placements') {
        // Resolve the asset handle with the same Rixse parameter vocabulary.
        const resolved = rixseScene.wire.resolve({ type: 'place_asset', payload: { asset_id: args.asset_id, anchor: args.anchor } }, { asset_id: { ref: 'asset' }, anchor: { ref: 'anchor' } }).payload;
        await hydrateAsset(personalAssets.get(resolved.asset_id));
        const asset = agentLibrary().find(a => a.id === resolved.asset_id); if (!asset) throw new Error('Unknown library asset.');
        const anchors = agentAnchors(), names = resolved.anchor ? [resolved.anchor] : Object.keys(anchors).filter(a => !a.startsWith('object:'));
        const positions = [];
        for (const anchor of names) {
          try { positions.push({ anchor, ...resolvePlacement({ anchor }, anchors, agentClear(asset, 0)) }); } catch { /* Other anchors can still be clear. */ }
        }
        return { ok: true, positions };
      }
      throw new Error('Unknown Studio tool.');
    } catch (error) { return { ok: false, error: error.message }; }
  },
};
window.studioNotice = hint;

const catalog=createCatalog({register:registerSavedAsset,changed:renderLibrary,notice:hint,clearKeys:clearMovementKeys});
window.__studio.library=catalog;
void catalog.collect().catch(error=>hint(`Could not restore your collection: ${error.message??error}`));
