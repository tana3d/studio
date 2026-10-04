// Transactions group one drag, movement, recording, or discrete edit into one undo.
// Completed performance/video buffers are immutable references, never deep-copied.
export class EditHistory {
  constructor(capture, restore, limit = 80) {
    this.capture = capture; this.restore = restore; this.limit = limit;
    this.past = []; this.future = []; this.pending = null; this.restoring = false;
  }
  begin(label) {
    if (this.restoring) return;
    if (this.pending) this.commit();
    this.pending = { label, before: this.capture() };
  }
  commit() {
    if (!this.pending || this.restoring) return;
    const entry = { ...this.pending, after: this.capture() };
    this.pending = null;
    this.past.push(entry); this.future = [];
    if (this.past.length > this.limit) this.past.shift();
  }
  discard() { this.pending = null; }
  run(label, edit) { this.begin(label); edit(); this.commit(); }
  undo() {
    if (this.pending) this.commit();
    const entry = this.past.pop(); if (!entry) return null;
    this.restoring = true;
    try { this.restore(entry.before); this.future.push(entry); }
    finally { this.restoring = false; }
    return entry.label;
  }
  redo() {
    const entry = this.future.pop(); if (!entry) return null;
    this.restoring = true;
    try { this.restore(entry.after); this.past.push(entry); }
    finally { this.restoring = false; }
    return entry.label;
  }
}
