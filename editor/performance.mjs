// One scene clock, immutable completed clips, and an independent recording lane.
export class PerformanceTimeline {
  constructor(capture, apply) {
    this.capture = capture; this.apply = apply;
    this.mode = 'live'; this.time = 0; this.items = []; this.active = null;
    this.recording = null; this.base = null; this.sequence = 0;
  }
  clipLength(item) { return Math.max(0, (item.outPoint ?? item.duration) - item.inPoint); }
  get duration() { return Math.max(this.minimumDuration ?? 0, ...this.items.map(item => item.start + this.clipLength(item))); }
  includeActors() {
    if (!this.base) return;
    const current = this.capture();
    this.base = { ...this.base, actors: { ...current.actors, ...this.base.actors } };
  }
  record(world, actorNames) {
    if (this.recording) return;
    const current = this.capture();
    if (!actorNames?.length || actorNames.some(name => !current.actors[name])) throw new Error('Choose a character to record.');
    this.base ??= current;
    this.includeActors();
    this.active = { id: `performance-${++this.sequence}`, name: `${actorNames.join(', ')} · Movement ${this.sequence}`,
      actorNames: [...actorNames], fps: 60, start: this.time, inPoint: 0, outPoint: null, muted: false,
      duration: 0, world, frames: [] };
    this.items.push(this.active); this.recording = this.active; this.mode = 'recording';
    this.sample();
    this.evaluate(new Set(actorNames));
  }
  sample() {
    const snapshot = this.capture(), item = this.recording;
    const time = Math.max(0, this.time - item.start);
    item.frames.push({ time, worldTime: snapshot.worldTime,
      actors: Object.fromEntries(item.actorNames.map(name => [name, snapshot.actors[name]])) });
    item.duration = time;
  }
  stop() {
    if (this.recording) { this.recording.outPoint = this.recording.duration; this.recording = null; }
    if (this.mode === 'recording' || this.mode === 'playing') this.mode = 'paused';
    if (this.base) this.evaluate();
  }
  seek(time) {
    if (this.recording || !Number.isFinite(time)) return;
    this.mode = 'paused'; this.time = Math.max(0, Math.min(300, time)); this.evaluate();
  }
  // Overlapping clips on different characters play together. On the same actor,
  // the most recently added active clip wins; gaps hold the preceding end pose.
  sourceFor(name, excluded) {
    const candidates = this.items.filter(i => i !== this.recording && !i.muted && i.actorNames.includes(name) && !excluded.has(name));
    const covering = candidates.filter(i => this.time >= i.start && this.time <= i.start + this.clipLength(i) + 1e-8);
    if (covering.length) return covering.at(-1);
    const previous = candidates.filter(i => i.start <= this.time).sort((a,b) => b.start + this.clipLength(b) - a.start - this.clipLength(a));
    return previous[0] ?? candidates.sort((a,b) => a.start-b.start)[0];
  }
  evaluate(excluded = new Set()) {
    if (!this.base) return;
    const base = { worldTime: this.base.worldTime + this.time,
      actors: Object.fromEntries(Object.entries(this.base.actors).filter(([name]) => !excluded.has(name))) };
    this.apply(base, base, 0, true);
    for (const name of Object.keys(this.base.actors)) {
      const item = this.sourceFor(name, excluded); if (!item?.frames.length) continue;
      const time = Math.max(item.inPoint, Math.min(item.outPoint ?? item.duration, this.time-item.start+item.inPoint));
      const index = Math.min(item.frames.length-1, Math.floor(time*item.fps+1e-7));
      const a = item.frames[index], b = item.frames[Math.min(index+1,item.frames.length-1)];
      const alpha = b.time > a.time ? Math.max(0, Math.min(1,(time-a.time)/(b.time-a.time))) : 0;
      this.apply({ worldTime:base.worldTime, actors:{[name]:a.actors[name]} },
        { worldTime:base.worldTime, actors:{[name]:b.actors[name]} }, alpha, true);
    }
  }
  updateClip(id, patch) {
    if (this.recording) return;
    const old = this.items.find(i=>i.id===id); if (!old) return;
    const item = {...old, ...patch};
    const number=(v,fallback)=>Number.isFinite(v)?v:fallback;
    item.inPoint=Math.max(0,Math.min(Math.max(0,item.duration-1/item.fps),number(item.inPoint,old.inPoint)));
    item.outPoint=Math.max(item.inPoint+Math.min(1/item.fps,item.duration),Math.min(item.duration,number(item.outPoint,old.outPoint)));
    item.start=Math.max(0,Math.min(300-this.clipLength(item),number(item.start,old.start)));
    this.items=this.items.map(i=>i.id===id?item:i); if(this.active?.id===id)this.active=item;
    this.mode='paused';this.evaluate();return item;
  }
  removeClip(id) {
    if(this.recording)return;
    this.items=this.items.filter(i=>i.id!==id);
    if(this.active?.id===id)this.active=this.items.at(-1)??null;
    this.mode='paused';this.evaluate();
  }
  splitClip(id,time=this.time){
    if(this.recording||!Number.isFinite(time))return;
    const index=this.items.findIndex(item=>item.id===id),item=this.items[index];if(!item)return;
    const offset=time-item.start,min=1/item.fps;
    if(offset<min-1e-8||this.clipLength(item)-offset<min-1e-8)return;
    const cut=item.inPoint+offset;
    const left={...item,outPoint:cut},right={...item,id:`performance-${++this.sequence}`,start:time,inPoint:cut};
    this.items.splice(index,1,left,right);this.active=right;this.mode='paused';this.evaluate();return right;
  }
  play() {
    if (!this.duration || this.recording) return;
    this.base ??= this.capture();
    if (this.time >= this.duration) this.time = 0;
    this.mode = 'playing'; this.evaluate();
  }
  step(dt, simulate) {
    if (this.mode === 'live') simulate(dt);
    else if(this.mode === 'recording') {
      this.time += dt;
      this.evaluate(new Set(this.recording.actorNames));
      simulate(dt, this.recording.actorNames); this.sample();
    } else if (this.mode === 'playing') {
      this.time = Math.min(this.duration, this.time + dt); this.evaluate();
      if (this.time >= this.duration) this.stop();
    }
  }
}
