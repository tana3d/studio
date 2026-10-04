import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneBridge } from './rixse-scene.mjs';
import { EditHistory } from './history.mjs';

function fixture() {
  let state = { library: [{ id: 'cone', name: 'Traffic cone', category: 'props', footprint: [.45,.45], height: .7 }],
    objects: [], characters: [], anchors: { camera_foreground: { name: 'Foreground', position: [0,0,2] } } };
  const history = new EditHistory(() => structuredClone(state), next => state = structuredClone(next));
  const bridge = createSceneBridge({ read: () => structuredClone(state), id: () => 'cone-1',
    clear: (_, __, ignore) => ([x,y,z]) => y >= 0 && Math.abs(x) < 4 && z < 7 && !state.objects.some(o => o.id !== ignore && Math.hypot(x-o.position[0],z-o.position[2]) < .5),
    project: (op, author) => history.run(op.type, () => {
      if (op.type === 'place_asset') state.objects.push(op.record);
      else if (op.type === 'delete_prop') state.objects = state.objects.filter(o => o.id !== op.record.id);
      else state.objects = state.objects.map(o => o.id === op.record.id ? op.record : o);
    }, author),
  });
  return { bridge, history, state: () => state };
}

test('Rixse resolves wire handles, records the author, and global undo/redo restores accepted scene state', async () => {
  const f = fixture(); const encoded = f.bridge.encode();
  assert.ok(encoded.vocabulary.includes('place_asset'));
  const asset = f.bridge.wire.handle('asset', 'cone'), anchor = f.bridge.wire.handle('anchor', 'camera_foreground');
  const added = await f.bridge.dispatch({ type: 'place_asset', payload: { asset_id: asset, anchor } }, 'agent');
  assert.equal(added.ok, true); assert.deepEqual(added.position, [0,0,2]);
  assert.equal(f.bridge.log.at(-1).author, 'agent');
  assert.equal(f.history.past.at(-1).store.log.at(-1).author, 'agent');
  f.history.undo(); assert.equal(f.state().objects.length, 0);
  f.history.redo(); assert.equal(f.state().objects[0].id, 'cone-1');
  const object = f.bridge.wire.handle('object', 'cone-1');
  const moved = await f.bridge.dispatch({ type: 'move_prop', payload: { object_id: object, x: 1, y: 0, z: 2 } }, 'you');
  assert.equal(moved.ok, true); assert.equal(f.bridge.log.at(-1).author, 'you');
  f.history.undo(); assert.deepEqual(f.state().objects[0].position, [0,0,2]);
});

test('Rixse rejects malformed, occupied and stale entity actions without projecting them', async () => {
  const f = fixture(); f.bridge.encode();
  assert.equal((await f.bridge.dispatch({ type: 'place_asset', payload: { asset_id: 'cone', anchor: 'camera_foreground' } })).ok, true);
  for (const action of [
    { type: 'place_asset', payload: { asset_id: 'cone', x: 0, y: 0, z: 2 } },
    { type: 'place_asset', payload: { asset_id: 'cone', x: NaN, y: 0, z: 2 } },
    { type: 'place_asset', payload: { asset_id: 'cone', anchor: 'camera_foreground', unexpected: true } },
    { type: 'delete_prop', payload: { object_id: 'deleted' } },
    { type: 'execute_code', payload: {} },
  ]) assert.equal((await f.bridge.dispatch(action)).ok, false);
  assert.equal(f.state().objects.length, 1); assert.equal(f.history.past.length, 1);
  f.history.undo();
  assert.equal((await f.bridge.dispatch({ type: 'move_prop', payload: { object_id: 'cone-1', x: 1, y: 0, z: 2 } })).ok, false);
  assert.equal(f.state().objects.length, 0);
});
