import test from 'node:test';
import assert from 'node:assert/strict';
import { damping, movementIntent, turnToward, slideCharacter, controlShortcut, jumpStep } from './controls.mjs';

test('diagonal movement has full directional precision and the same speed as forward',()=>{
  for(const yaw of [0,.17,Math.PI/2,-2.7])for(const [forward,side] of [[1,0],[1,1],[-1,1],[0,-1]]){
    const intent=movementIntent(forward,side,yaw,1.8);
    assert.ok(Math.abs(Math.hypot(intent.x,intent.z)-1.8)<1e-12);
    if(!yaw&&forward===side)assert.equal(Math.abs(intent.x),Math.abs(intent.z));
  }
});
test('acceleration and turning are independent of frame rate and take the shortest turn',()=>{
  const sample=rate=>{let v=0,yaw=3.1;for(let i=0;i<rate;i++){v+=(1.8-v)*damping(18,1/rate);yaw=turnToward(yaw,-3.1,1/rate);}return [v,yaw];};
  const a=sample(30),b=sample(120);a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-10));
  assert.ok(a[1]>3.1&&a[1]<3.2);
});
test('round collision slides diagonally along a wall without tunnelling through a thin prop',()=>{
  const bounds=[[-10,-10],[10,10]],wall={minX:0,maxX:.05,minZ:-8,maxZ:8,y:0,h:2};
  const p=slideCharacter({x:-1,y:0,z:0},{x:3,z:-2},.3,bounds,[wall],1.8);
  assert.ok(p.x<=-.3+1e-8);assert.ok(Math.abs(p.z+2)<1e-8);
  const free=slideCharacter({x:0,y:0,z:0},{x:1,z:-1},.3,bounds,[],1.8);assert.deepEqual(free,{x:1,z:-1});
});
test('hanging props do not block movement and world boundaries keep the capsule inside',()=>{
  const bounds=[[-2,-2],[2,2]],prop={minX:-.5,maxX:.5,minZ:-.5,maxZ:.5,y:3,h:1};
  const p=slideCharacter({x:-1,y:0,z:0},{x:4,z:0},.3,bounds,[prop],1.8);assert.equal(p.x,1.7);
});
test('shortcuts map Free to 1, eight world cameras to 2–9, and backquote to character toggle',()=>{
  const event=code=>({code,metaKey:true,shiftKey:true});
  assert.deepEqual(controlShortcut(event('Digit1')),{type:'camera',index:-1});
  assert.deepEqual(controlShortcut(event('Digit9')),{type:'camera',index:7});
  assert.deepEqual(controlShortcut(event('Backquote')),{type:'character'});
  assert.equal(controlShortcut({...event('Digit1'),shiftKey:false}),null);
  assert.equal(controlShortcut({...event('Digit1'),altKey:true}),null);
});
test('a jump follows gravity at any frame rate and lands exactly on its starting elevation',()=>{
  for(const rate of [30,60,120]){
    let y=2,velocity=5.2,peak=y,landed=false;
    for(let i=0;i<rate;i++){const result=jumpStep(y,velocity,2,1,1/rate);({y,velocity,landed}=result);peak=Math.max(peak,y);if(landed)break;}
    assert.ok(peak>2.8&&peak<2.85);assert.equal(y,2);assert.equal(velocity,0);assert.ok(landed);
  }
});
