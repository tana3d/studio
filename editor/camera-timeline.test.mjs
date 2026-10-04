import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraTimeline} from './camera-timeline.mjs';
test('cuts remain ordered, contiguous, and transition sampling is deterministic backwards',()=>{
 const t=new CameraTimeline(),a=t.add(3,{name:'A'}),b=t.add(2,{name:'B'}),c=t.add(4,{name:'C'});
 assert.equal(a.start,0);t.update(b.id,{transition:'Fade',duration:1});
 assert.equal(t.sample(1.9,6).shot,a);assert.equal(t.sample(2,6).progress,0);
 assert.equal(t.sample(2.5,6).previous,a);assert.equal(t.sample(2.5,6).progress,.5);
 assert.equal(t.sample(3,6).previous,null);assert.equal(t.sample(2.5,6).progress,.5);
 t.update(b.id,{start:12});assert.equal(b.start,3.9);
 assert.ok(Math.abs(t.sample(3.95,6).progress-.5)<1e-10,'effect shortened to fit incoming shot');
 t.remove(a.id);assert.equal(b.start,0);t.update(b.id,{start:5});assert.equal(b.start,3.9);t.update(b.id,{start:0});
 t.update(c.id,{transition:'Wipe',duration:-2});assert.equal(c.duration,.05);
});
test('replacing a camera at the same cut preserves timing and effect; input camera is copied',()=>{
 const t=new CameraTimeline(),spec={name:'A',position:[1,2,3]},a=t.add(0,spec);spec.position[0]=9;assert.equal(a.spec.position[0],1);
 const b=t.add(2,{name:'B'});t.update(b.id,{transition:'Wipe',duration:2});
 assert.equal(t.add(2,{name:'C'}),b);assert.equal(t.shots.length,2);assert.equal(b.transition,'Wipe');
 assert.equal(t.sample(2.5,3).progress,.5);assert.equal(t.sample(3,3).previous,null);
});

test('boundary insertion ripples later angles and keeps every camera spec',()=>{
 const t=new CameraTimeline();t.add(0,{name:'A'});t.add(4,{name:'B'});
 const added=t.insert(4,2,{name:'C'},10);
 assert.deepEqual(t.shots.map(s=>[s.spec.name,s.start,s.length]),[['A',0,4],['C',4,2],['B',6,6]]);
 assert.equal(added.spec.name,'C');assert.equal(t.end,12);
 assert.equal(t.sample(5,12).shot,added);assert.equal(t.sample(6,12).shot.spec.name,'B');
});
test('middle insertion requires confirmation, preserves both halves, and can be undone as one snapshot',()=>{
 const t=new CameraTimeline();const source=t.add(0,{name:'A',position:[1,2,3]});t.add(6,{name:'B'});
 const before=structuredClone(t.shots);
 assert.throws(()=>t.insert(2,3,{name:'C'},10),/Confirm/);assert.deepEqual(t.shots,before);
 t.insert(2,3,{name:'C'},10,{split:true});
 assert.deepEqual(t.shots.map(s=>[s.spec.name,s.start,s.length]),[['A',0,2],['C',2,3],['A',5,4],['B',9,4]]);
 assert.notEqual(t.shots[0].id,t.shots[2].id);assert.deepEqual(t.shots[2].spec,source.spec);assert.equal(t.end,13);
 t.shots[2].spec.position[0]=9;assert.equal(t.shots[0].spec.position[0],1);
});
test('delete ripples the camera track, allows the only angle to be removed, and handles gaps',()=>{
 const t=new CameraTimeline();t.insert(2,3,{name:'A'},0);assert.equal(t.sample(0,5),null);
 t.insert(5,2,{name:'B'},5);t.remove(t.shots[0].id,7);
 assert.deepEqual(t.shots.map(s=>[s.spec.name,s.start,s.length]),[['B',2,2]]);
 t.remove(t.shots[0].id,4);assert.equal(t.shots.length,0);assert.equal(t.sample(1,2),null);
});
test('invalid insertion does not partially mutate the edit',()=>{
 const t=new CameraTimeline();t.add(0,{name:'A'});const before=structuredClone(t.shots);
 for(const [time,length,end] of [[2,0,10],[NaN,2,10],[299,3,300]])assert.throws(()=>t.insert(time,length,{},end,{split:true}));
 assert.deepEqual(t.shots,before);
});

test('retiming a shared cut preserves the total span and both camera settings',()=>{
 const t=new CameraTimeline();t.insert(0,2,{name:'A'},0);const b=t.insert(2,3,{name:'B'},2);
 t.trimStart(b.id,3);assert.deepEqual(t.shots.map(s=>[s.start,s.length]),[[0,3],[3,2]]);
 t.trimStart(b.id,-1);assert.deepEqual(t.shots.map(s=>[s.start,s.length]),[[0,.1],[.1,4.9]]);
 assert.equal(t.sample(.2,5).shot.spec.name,'B');
});

test('shortening or deleting the final camera drops the stale scene end',()=>{
 const t=new CameraTimeline();const a=t.insert(0,3,{name:'A'},0),b=t.insert(3,4,{name:'B'},3);
 t.update(b.id,{length:1});assert.equal(t.duration(),4);assert.equal(t.end,4);
 t.remove(b.id,4);assert.equal(t.duration(),3);assert.equal(t.end,3);
 t.remove(a.id,3);assert.equal(t.duration(10),0);assert.equal(t.end,0);
 const gap=t.insert(2,1,{name:'Gap'},0);t.remove(gap.id,3);assert.equal(t.duration(10),0,'an empty track has no phantom gap duration');
});
test('camera split keeps both views and all later timings, with no ripple',()=>{
 const t=new CameraTimeline();const a=t.insert(0,3,{name:'A',position:[1,2,3]},0),b=t.insert(3,2,{name:'B'},3);
 const later=structuredClone(b);assert.equal(t.split(a.id,0,5),undefined);assert.equal(t.shots.length,2);
 const right=t.split(a.id,1.2,5);assert.equal(t.duration(),5);assert.equal(right.start,1.2);assert.equal(a.length,1.2);assert.equal(right.length,1.8);
 assert.deepEqual(right.spec,a.spec);assert.notEqual(right.spec,a.spec);assert.deepEqual(b,later);
 for(const time of [.5,1.2,2.9])assert.equal(t.sample(time,5).shot.spec.name,'A');
});

test('splitting during a camera transition preserves its source and progress',()=>{
 const t=new CameraTimeline();t.insert(0,2,{name:'A'},0);const b=t.insert(2,2,{name:'B'},2);t.update(b.id,{transition:'Fade',duration:1});
 const times=[2.1,2.3,2.4,2.9,3.1],sample=time=>{const s=t.sample(time,4);return{camera:s.shot.spec,previous:s.previous?.spec,progress:s.progress,transition:s.transition};};
 const before=times.map(sample);const right=t.split(b.id,2.3,4);
 times.forEach((time,i)=>{const after=sample(time);assert.deepEqual(after.camera,before[i].camera);assert.deepEqual(after.previous,before[i].previous);assert.equal(after.transition,before[i].transition);assert.ok(Math.abs(after.progress-before[i].progress)<1e-8);});
 t.split(right.id,2.6,4);assert.ok(Math.abs(t.sample(2.8,4).progress-.8)<1e-8,'multiple splits retain effect progress');
});
