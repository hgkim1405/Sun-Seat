import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/processed/seat-layouts.json');

export class SeatLayoutRepository {
  constructor({ file = defaultFile } = {}) {
    this.file = file;
    this.data = null;
  }

  async load() {
    if (!this.data) {
      try { this.data = JSON.parse(await fs.readFile(this.file, 'utf8')); }
      catch (error) {
        if (error?.code === 'ENOENT') this.data = { layouts: [] };
        else throw error;
      }
    }
    return this.data;
  }

  async get(layoutId) {
    const data = await this.load();
    return data.layouts?.find((layout) => layout.id === layoutId && layout.verified === true) ?? null;
  }
}
