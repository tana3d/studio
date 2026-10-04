// Transactions group one drag, movement, recording, or discrete edit into one undo.
// Completed performance/video buffers are immutable references, never deep-copied.
export class EditHistory {
  constructor(capture, restore, limit = 80) {
    this.capture = capture; this.restore = restore; this.limit = limit;
    this.past = []; this.future = []; this.pending = null; this.restoring = false;
  }
  begin(label, author = 'you') {
    if (this.restoring) return;
    if (this.pending) this.commit();
    this.pending = { label, author, before: this.capture() };
  }
  commit() {
    if (!this.pending || this.restoring) return;
    const entry = { ...this.pending, after: this.capture() };
    // Rixse owns the accepted state and author for each global transaction.
    // The editor's history keeps the bounded undo/redo order and buffer refs.
    entry.store = createStore({ initial: entry.before, actions: [defineAction('edit.commit', {
      describe: 'Commit a completed scene, camera or performance edit',
      params: { label: { type: 'string' } }, apply: () => entry.after,
    })] });
    entry.store.dispatch({ type: 'edit.commit', payload: { label: entry.label } }, entry.author);
    this.pending = null;
    this.past.push(entry); this.future = [];
    if (this.past.length > this.limit) this.past.shift();
  }
  discard() { this.pending = null; }
  run(label, edit, author = 'you') { this.begin(label, author); edit(); this.commit(); }
  undo() {
    if (this.pending) this.commit();
    const entry = this.past.pop(); if (!entry) return null;
    this.restoring = true;
    try { entry.store.undo(); this.restore(entry.store.state); this.future.push(entry); }
    finally { this.restoring = false; }
    return entry.label;
  }
  redo() {
    const entry = this.future.pop(); if (!entry) return null;
    this.restoring = true;
    try { entry.store.dispatch({ type: 'edit.commit', payload: { label: entry.label } }, entry.author); this.restore(entry.store.state); this.past.push(entry); }
    finally { this.restoring = false; }
    return entry.label;
  }
}
import { createStore, defineAction } from 'rixse';
