// -----------------------------------------------------------------------------
// Small JSON files under /data, the only writable volume of the container.
//
// Written atomically (temporary file, then rename) and readable by the owner
// only: the session file holds the cloud tokens. A missing or broken file
// reads as the fallback: everything stored here can be rebuilt.
// -----------------------------------------------------------------------------

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class Store {
  /** @param {string} dir */
  constructor(dir = '/data') {
    this.dir = dir;
  }

  /**
   * @param {string} name file name, e.g. 'session.json'
   * @param {any} fallback returned when the file is missing or unreadable
   */
  read(name, fallback) {
    try {
      return JSON.parse(readFileSync(join(this.dir, name), 'utf8'));
    } catch {
      return fallback;
    }
  }

  /**
   * @param {string} name
   * @param {any} value JSON-serializable
   * @returns {boolean} false when the volume refused the write (logged by the caller)
   */
  write(name, value) {
    const path = join(this.dir, name);
    const tmp = `${path}.tmp`;
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
      renameSync(tmp, path);
      return true;
    } catch {
      return false;
    }
  }
}

/** A store kept in memory, for the tests and for a container without /data. */
export class MemoryStore {
  constructor(initial = {}) {
    this.files = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  }

  read(name, fallback) {
    return this.files.has(name) ? JSON.parse(this.files.get(name)) : fallback;
  }

  write(name, value) {
    this.files.set(name, JSON.stringify(value));
    return true;
  }
}
