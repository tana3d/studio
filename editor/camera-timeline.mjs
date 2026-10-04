// Camera intervals share the scene clock. Initial legacy shots may follow scene
// length; an insert/delete materializes their lengths before editing the track.
export class CameraTimeline {
  constructor() { this.shots=[];this.sequence=0;this.end=0; }
  length(shot,end){const i=this.shots.indexOf(shot);return shot.length??Math.max(0,(this.shots[i+1]?.start??end)-shot.start);}
  duration(fallback=0){return Math.max(0,...this.shots.map(shot=>shot.start+this.length(shot,this.end||fallback)));}
  syncEnd(){if(this.shots.every(shot=>shot.length!==undefined))this.end=this.duration();}
  materialize(end){for(const shot of this.shots)shot.length=this.length(shot,end);}
  add(time,spec) {
    time=this.shots.length?Math.max(0,Math.min(299.9,time)):0;
    const existing=this.shots.find(s=>Math.abs(s.start-time)<.05);
    if(existing){existing.spec=structuredClone(spec);return existing;}
    const shot={id:`shot-${++this.sequence}`,start:time,spec:structuredClone(spec),transition:'None',duration:.5};
    this.shots.push(shot);this.shots.sort((a,b)=>a.start-b.start);return shot;
  }
  at(time,end){return this.shots.findLast(s=>time>=s.start-1e-8&&time<s.start+this.length(s,end)-1e-8)??null;}
  insertion(time,length,end){
    if(!Number.isFinite(time)||!Number.isFinite(length)||time<0||length<.1||Math.max(end,time)+length>300+1e-8)throw new Error('Keep the camera edit within five minutes. Choose a shorter angle or an earlier position.');
    const shot=this.at(time,end);
    return {shot,split:!!shot&&time>shot.start+1e-7};
  }
  insert(time,length,spec,end,{split=false}={}){
    const intent=this.insertion(time,length,end);
    if(intent.split&&!split)throw new Error('Confirm splitting the existing camera angle first.');
    this.materialize(end);
    let tail=null;
    if(intent.split){
      const shot=intent.shot,offset=time-shot.start;
      tail={...structuredClone(shot),id:`shot-${++this.sequence}`,start:time+length,length:shot.length-offset,transition:'None'};
      shot.length=offset;
    }
    for(const shot of this.shots)if(shot.start>=time-1e-8)shot.start+=length;
    const added={id:`shot-${++this.sequence}`,start:time,length,spec:structuredClone(spec),transition:'None',duration:.5};
    this.shots.push(added);if(tail)this.shots.push(tail);this.shots.sort((a,b)=>a.start-b.start);
    this.syncEnd();return added;
  }
  trimStart(id,time){
    const index=this.shots.findIndex(s=>s.id===id),shot=this.shots[index];if(!shot||!Number.isFinite(time))return;
    const prev=this.shots[index-1],end=shot.start+shot.length;
    const adjacent=prev&&Math.abs(prev.start+prev.length-shot.start)<1e-6;
    const min=prev?(adjacent?prev.start+.1:prev.start+prev.length):0;
    const start=Math.max(min,Math.min(end-.1,time));
    if(adjacent)prev.length=start-prev.start;
    shot.start=start;shot.length=end-start;
    this.syncEnd();
  }
  split(id,time,end=this.duration()){
    const index=this.shots.findIndex(shot=>shot.id===id),shot=this.shots[index];
    if(!shot||!Number.isFinite(time))return;
    const offset=time-shot.start,length=this.length(shot,end);
    if(offset<.1-1e-8||length-offset<.1-1e-8)return;
    this.materialize(end);
    const right={...structuredClone(shot),id:`shot-${++this.sequence}`,start:time,length:length-offset,transition:'None'};
    delete right.transitionSpan;delete right.transitionOffset;delete right.transitionSource;
    const prior=this.shots[index-1],span=shot.transitionSpan??Math.min(shot.duration,length),phase=shot.transitionOffset??0;
    const source=shot.transitionSource??(prior&&Math.abs(prior.start+prior.length-shot.start)<1e-6?prior.spec:null);
    if(source&&shot.transition!=='None'&&phase+offset<span){
      shot.transitionSpan=span;
      Object.assign(right,{transition:shot.transition,transitionSpan:span,transitionOffset:phase+offset,transitionSource:structuredClone(source)});
    }
    shot.length=offset;this.shots.splice(index+1,0,right);this.syncEnd();return right;
  }
  update(id,patch) {
    const index=this.shots.findIndex(s=>s.id===id);if(index<0)return;
    const shot=this.shots[index];
    if(Number.isFinite(patch.start)){
      const prev=this.shots[index-1],next=this.shots[index+1];
      const min=prev?(prev.length===undefined?prev.start+.1:prev.start+prev.length):0;
      const max=(next?.start??300)-(shot.length??.1);
      shot.start=Math.max(min,Math.min(max,patch.start));
    }
    if(Number.isFinite(patch.length))shot.length=Math.max(.1,Math.min((this.shots[index+1]?.start??300)-shot.start,patch.length));
    if('transition' in patch||'duration' in patch){delete shot.transitionSpan;delete shot.transitionOffset;delete shot.transitionSource;}
    if(['None','Fade','Wipe'].includes(patch.transition))shot.transition=patch.transition;
    if(Number.isFinite(patch.duration))shot.duration=Math.max(.05,Math.min(10,patch.duration));
    if(patch.spec)shot.spec=structuredClone(patch.spec);
    this.syncEnd();
    return shot;
  }
  remove(id,end=this.end){
    const shot=this.shots.find(s=>s.id===id);if(!shot)return;
    // With no supplied duration, retain compatibility with initial cut-only edits.
    if(!end){this.shots=this.shots.filter(s=>s!==shot);if(this.shots[0])this.shots[0].start=0;return;}
    this.materialize(end);this.shots=this.shots.filter(s=>s!==shot);
    for(const later of this.shots)if(later.start>=shot.start+shot.length-1e-8)later.start-=shot.length;
    this.syncEnd();
  }
  sample(time,end){
    // Hold the final rendered frame exactly at the composition end.
    const shot=this.at(time===end&&end>0?time-1e-7:time,end);if(!shot)return null;
    const index=this.shots.indexOf(shot),duration=shot.transitionSpan??Math.min(shot.duration,this.length(shot,end));
    const progress=duration>0?Math.min(1,Math.max(0,(time-shot.start+(shot.transitionOffset??0))/duration)):1;
    const prior=this.shots[index-1];
    const adjacent=prior&&Math.abs(prior.start+this.length(prior,end)-shot.start)<1e-6;
    const source=shot.transitionSource?{spec:shot.transitionSource}:adjacent?prior:null;
    const previous=source&&shot.transition!=='None'&&progress<1?source:null;
    return {shot,previous,progress,transition:previous?shot.transition:'None',duration};
  }
}
