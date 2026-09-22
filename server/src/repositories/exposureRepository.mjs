import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryDir = path.dirname(fileURLToPath(import.meta.url));
const defaultCacheDir = path.resolve(repositoryDir, '../../../data/cache/exposure');

export class ExposureRepository {
  constructor({ directory = defaultCacheDir } = {}) {
    this.directory = directory;
  }

  key(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  async get(key) {
    try {
      return JSON.parse(await fs.readFile(path.join(this.directory, `${key}.json`), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async put(key, value) {
    await fs.mkdir(this.directory, { recursive: true });
    const file = path.join(this.directory, `${key}.json`);
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, file);
  }
}
