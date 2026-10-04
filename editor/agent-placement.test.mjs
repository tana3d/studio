import { resolvePlacement } from './agent-placement.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

test('an anchor finds nearby clear space and reports the adjustment', () => {
  const result = resolvePlacement({ anchor: 'foreground', offset: [0,0,0] }, { foreground: { position: [0,0,2] } }, ([x]) => x >= .5);
  assert.deepEqual(result, { position: [.5,0,2], adjusted: true });
});
test('exact coordinates fail instead of silently moving, and invalid values never reach the engine', () => {
  assert.throws(() => resolvePlacement({ position: [0,0,0] }, {}, () => false), /overlaps/);
  assert.throws(() => resolvePlacement({ position: [NaN,0,0] }, {}, () => true), /finite|metres/);
  assert.throws(() => resolvePlacement({ anchor: '__proto__' }, {}, () => true), /Unknown/);
  assert.throws(() => resolvePlacement({ anchor: 'ground', position: [0,0,0] }, { ground: { position: [0,0,0] } }, () => true), /not both/);
});
test('offsets use world coordinates and no-clear-space is reported', () => {
  assert.deepEqual(resolvePlacement({ anchor: 'ground', offset: [1,0,-2] }, { ground: { position: [0,0,3] } }, () => true).position, [1,0,1]);
  assert.throws(() => resolvePlacement({ anchor: 'ground' }, { ground: { position: [0,0,0] } }, () => false), /No clear spot/);
});
