import { createStore, defineAction, createWire, Rejected } from 'rixse';
import { resolvePlacement } from './agent-placement.mjs';

const str = (ref, optional = false) => ({ type: 'string', ...(ref ? { ref } : {}), optional });
const num = { type: 'number', optional: true };
const location = { anchor: str('anchor', true), x: num, y: num, z: num, dx: num, dy: num, dz: num, rotation_y: num };

// The Three.js renderer projects the accepted state. Mesh data stays local;
// Rixse exposes typed actions and stable handles for the scene's entities.
export function createSceneBridge({ read, project, clear, prepare = async () => {}, id = () => crypto.randomUUID() }) {
  const audit = [];
  const reject = message => { throw new Rejected(message); };
  const at = (state, asset, p, ignore, scale = 1) => {
    const rotationY = p.rotation_y ?? 0;
    try {
      return { ...resolvePlacement({ anchor: p.anchor,
        position: p.x == null && p.y == null && p.z == null ? null : [p.x, p.y, p.z],
        offset: [p.dx ?? 0, p.dy ?? 0, p.dz ?? 0] }, state.anchors, clear({...asset,footprint:asset.footprint?.map(v=>v*scale),height:asset.height*scale}, rotationY, ignore)), rotationY };
    } catch (error) { reject(error.message); }
  };
  const actions = [
    defineAction('use_scene', {
      describe: 'Use a Scenes library asset as the starting set. Replaces scenery with editable pieces; preserves characters, cameras and performances. Undo restores the previous set.',
      params: {asset_id:str('asset')},
      apply: (state,p)=>{
        const asset=state.library.find(a=>a.id===p.asset_id);
        if(asset?.category!=='scenes')reject('Choose an asset from Scenes.');
        return {...state,operation:{type:'use_scene',asset},result:{ok:true,assetId:asset.id}};
      },
    }),
    defineAction('place_asset', {
      describe: 'Add a library prop or character. Use camera_foreground when no location is specified; anchors find nearby clear space. Exact x/y/z must be unoccupied. Returns the actual position.',
      params: { asset_id: str('asset'), ...location },
      apply: (state, p) => {
        const asset = state.library.find(a => a.id === p.asset_id);
        if (!asset) reject('Unknown library asset.');
        if(asset.category==='scenes')reject('Use use_scene to load a starting set.');
        const placement = at(state, asset, p);
        const record = { id: id(), assetId: asset.id, ...placement };
        if (asset.category === 'characters') {
          let suffix = 1;
          while (state.characters.some(c => c.name === `${asset.name} ${suffix}`) || state.reservedCharacterNames?.includes(`${asset.name} ${suffix}`)) suffix++;
          record.name = `${asset.name} ${suffix}`;
        }
        const key = asset.category === 'characters' ? 'characters' : 'objects';
        return { ...state, [key]: [...state[key], record], operation: { type: 'place_asset', asset, record }, result: { ok: true, ...record } };
      },
    }),
    defineAction('move_prop', {
      describe: 'Move/rotate a prop by its object handle. Leaves cameras and performances intact.',
      params: { object_id: str('object'), ...location },
      apply: (state, p) => {
        const existing = state.objects.find(o => o.id === p.object_id);
        if (!existing) reject('Object no longer exists. Read the scene again.');
        const asset = state.library.find(a => a.id === existing.assetId);
        if (!asset) reject('Unknown library asset.');
        const record = { ...existing, ...at(state, asset, p, existing.id, existing.scale ?? 1) };
        return { ...state, objects: state.objects.map(o => o.id === record.id ? record : o),
          operation: { type: 'move_prop', asset, record }, result: { ok: true, ...record } };
      },
    }),
    defineAction('resize_prop', {
      describe:'Resize a placed object uniformly. Scale 1 is its original size; 5 makes it five times larger. Keeps its floor height and updates collisions. Undo restores its size.',
      params:{object_id:str('object'),scale:{type:'number'}},
      apply:(state,p)=>{
        const existing=state.objects.find(o=>o.id===p.object_id);
        if(!existing)reject('Object no longer exists. Read the scene again.');
        if(!Number.isFinite(p.scale)||p.scale<.05||p.scale>20)reject('Scale must be between 0.05 and 20.');
        const asset=state.library.find(a=>a.id===existing.assetId);
        if(!asset)reject('Unknown library asset.');
        at(state,asset,{x:existing.position[0],y:existing.position[1],z:existing.position[2],rotation_y:existing.rotationY},existing.id,p.scale);
        const record={...existing,scale:p.scale};
        return {...state,objects:state.objects.map(o=>o.id===record.id?record:o),operation:{type:'resize_prop',asset,record},result:{ok:true,...record}};
      },
    }),
    defineAction('delete_prop', {
      describe: 'Remove one existing prop by object handle. Undo restores it.', params: { object_id: str('object') },
      apply: (state, p) => {
        const record = state.objects.find(o => o.id === p.object_id);
        if (!record) reject('Object no longer exists. Read the scene again.');
        return { ...state, objects: state.objects.filter(o => o.id !== p.object_id),
          operation: { type: 'delete_prop', record }, result: { ok: true, deleted: record.id } };
      },
    }),
  ];
  const wire = createWire({ entities: [
    { type: 'asset', list: s => s.library, id: a => a.id,
      fields: ['id', 'name', 'category', 'footprint', 'height'].map(name => ({ name })) },
    { type: 'object', list: s => s.objects, id: o => o.id,
      fields: [{ name: 'assetId', ref: 'asset' }, { name: 'position' }, { name: 'rotationY', default: 0 }, {name:'scale',default:1}] },
    { type: 'character', list: s => s.characters, id: c => c.name,
      fields: [{ name: 'name' }, { name: 'assetId', ref: 'asset' }, { name: 'position' }, { name: 'rotationY', default: 0 }] },
    { type: 'anchor', list: s => Object.entries(s.anchors).map(([id, a]) => ({ id, ...a })), id: a => a.id,
      fields: [{ name: 'id' }, { name: 'name' }, { name: 'position' }] },
  ] });
  const vocabulary = createStore({ initial: {}, actions }).vocabulary();
  return {
    wire, vocabulary,
    get log() { return audit.slice(); },
    encode() { return { wire: wire.encode(read()), legend: wire.legend(), vocabulary }; },
    async dispatch(action, author = 'agent') {
      // Each transaction starts at the real current scene, including human
      // movement and Undo. A stale model snapshot cannot overwrite later edits.
      const resolved = wire.resolve(action, actions.find(a=>a.type===action?.type)?.params ?? {});
      try { await prepare(resolved); } catch(error) { return {ok:false,error:error.message}; }
      const store = createStore({ initial: read(), actions });
      const def = actions.find(a => a.type === resolved?.type);
      if (resolved?.payload && Object.keys(resolved.payload).some(k => !Object.hasOwn(def?.params ?? {}, k))) return { ok: false, error: 'Unknown action field.' };
      const accepted = store.dispatch(resolved, author);
      if (!accepted.ok) { audit.push({ author, action: resolved, error: accepted.error }); if (audit.length > 80) audit.shift(); return accepted; }
      try {
        await project(store.state.operation, author);
        audit.push({ ...accepted.entry, result: store.state.result });
        if (audit.length > 80) audit.shift();
        return store.state.result;
      } catch (error) {
        store.undo();
        return { ok: false, error: error.message };
      }
    },
  };
}
