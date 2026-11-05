import { invariant } from './errors.mjs';

export class Registry {
  constructor(kind, entries = []) { this.kind = kind; this.entries = new Map(); for (const entry of entries) this.add(entry); }
  add(entry) {
    invariant(typeof entry?.id === 'string' && entry.id && entry.version === 1, 'PLUGIN_CONTRACT', `${this.kind} requires id and interface version=1.`);
    invariant(!this.entries.has(entry.id), 'DUPLICATE_PLUGIN', `${this.kind} already registered: ${entry.id}`);
    this.entries.set(entry.id, entry); return this;
  }
  get(id) { invariant(this.entries.has(id), 'PLUGIN_NOT_FOUND', `Unknown ${this.kind}: ${id}`); return this.entries.get(id); }
  ids() { return [...this.entries.keys()]; }
}
