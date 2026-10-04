import test from 'node:test';
import assert from 'node:assert/strict';
import {PerformanceTimeline} from './performance.mjs';
function setup(){
 let state={worldTime:12,actors:{A:{x:0},B:{x:10}}};
 const t=new PerformanceTimeline(()=>structuredClone(state),(a,b,alpha)=>{
   state.worldTime=a.worldTime;
   for(const [n,s] of Object.entries(a.actors))state.actors[n]={x:s.x+(b.actors[n].x-s.x)*alpha};
 });
 const move=(dt,names)=>{for(const n of names??[])state.actors[n].x+=dt*6;};
 return {t,state,move,record(n,seconds){t.record({},[n]);for(let i=0;i<seconds*60;i++)t.step(1/60,move);t.stop();return t.active;}};
}
test('overdub plays the first actor at the same clock while only capturing the second',()=>{
 const {t,state,record,move}=setup();const a=record('A',1);const original=JSON.stringify(a);
 t.seek(0);t.record({},['B']);for(let i=0;i<30;i++)t.step(1/60,move);
 assert.ok(Math.abs(state.actors.A.x-3)<1e-8);assert.ok(Math.abs(state.actors.B.x-13)<1e-8);
 assert.deepEqual(Object.keys(t.active.frames[1].actors),['B']);t.stop();assert.equal(JSON.stringify(a),original);
 t.seek(.25);assert.ok(Math.abs(state.actors.A.x-1.5)<1e-8);assert.ok(Math.abs(state.actors.B.x-11.5)<1e-8);
 assert.equal(state.worldTime,12.25);
});
test('offsets, gaps, non-destructive trim and mute compose predictably',()=>{
 const {t,state,record}=setup();const a=record('A',1);t.seek(0);const b=record('B',1);
 t.updateClip(b.id,{start:2,inPoint:.25,outPoint:.75});assert.equal(t.duration,2.5);
 t.seek(.5);assert.ok(Math.abs(state.actors.A.x-3)<1e-8);assert.ok(Math.abs(state.actors.B.x-11.5)<1e-8);
 t.seek(2.25);assert.ok(Math.abs(state.actors.B.x-13)<1e-8);
 t.updateClip(b.id,{muted:true});assert.equal(state.actors.B.x,10);
 t.updateClip(b.id,{muted:false});assert.ok(Math.abs(state.actors.B.x-13)<1e-8);
 assert.equal(b.inPoint,0);assert.equal(t.items[1].frames,b.frames,'edits share unchanged frame buffers');
 t.removeClip(a.id);assert.equal(state.actors.A.x,0);
});
test('newest overlapping take wins for one actor, older take resumes outside overlap',()=>{
 const {t,state,record}=setup();record('A',2);t.seek(.5);state.actors.A.x=100;record('A',.5);
 t.seek(.75);assert.ok(Math.abs(state.actors.A.x-101.5)<1e-8);
 t.seek(1.5);assert.ok(Math.abs(state.actors.A.x-9)<1e-8);
});
test('playback ends at the composition end and seeking is independent of selection',()=>{
 const {t,state,record}=setup();const a=record('A',1);t.seek(1);record('B',1);
 t.active=a;t.seek(.5);assert.equal(t.time,.5);t.play();for(let i=0;i<150;i++)t.step(1/60,()=>assert.fail('no simulation during playback'));
 assert.equal(t.mode,'paused');assert.equal(t.time,t.duration);assert.ok(Math.abs(state.actors.A.x-6)<1e-8);assert.ok(Math.abs(state.actors.B.x-16)<1e-8);
});
test('trim bounds reject negative length and nonfinite values',()=>{
 const {t,record}=setup();const a=record('A',1);
 const c=t.updateClip(a.id,{start:-5,inPoint:9,outPoint:-1});assert.equal(c.start,0);assert.ok(t.clipLength(c)>0);assert.ok(c.outPoint<=c.duration);
 const d=t.updateClip(a.id,{start:Infinity,inPoint:NaN});assert.equal(d.start,0);assert.ok(Number.isFinite(d.inPoint));
});

test('splitting an offset, trimmed movement preserves composite poses and duration',()=>{
 const {t,state,record}=setup();record('B',2);t.seek(0);const a=record('A',2);
 const trimmed=t.updateClip(a.id,{start:1,inPoint:.25,outPoint:1.75});
 const times=[0,1,1.1,1.7,1.8,2,2.5,3],before=times.map(time=>{t.seek(time);return structuredClone(state);}),duration=t.duration;
 assert.equal(t.splitClip(a.id,1),undefined);assert.equal(t.items.length,2);
 const right=t.splitClip(a.id,1.8),left=t.items[1];assert.equal(left.frames,trimmed.frames);assert.equal(right.frames,trimmed.frames);
 assert.equal(left.outPoint,1.05);assert.equal(right.inPoint,1.05);assert.equal(right.start,1.8);assert.equal(t.duration,duration);assert.equal(trimmed.outPoint,1.75);
 times.forEach((time,index)=>{t.seek(time);assert.deepEqual(state,before[index]);});
 t.removeClip(right.id);assert.ok(Math.abs(t.duration-2)<1e-8);t.removeClip(left.id);t.removeClip(t.items[0].id);assert.equal(t.duration,0);t.play();assert.equal(t.mode,'paused');
});
