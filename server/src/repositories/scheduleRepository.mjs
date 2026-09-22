import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryDir = path.dirname(fileURLToPath(import.meta.url));
const defaultCacheDir = path.resolve(repositoryDir, '../../../data/cache/schedules');

function cacheKey(origin, destination, date) {
  return crypto.createHash('sha256').update(`${origin}\0${destination}\0${date}`).digest('hex');
}

export class ScheduleRepository {
  constructor({ directory = defaultCacheDir, now = () => Date.now(), maxAgeMs = 6 * 60 * 60 * 1000 } = {}) {
    this.directory = directory;
    this.now = now;
    this.maxAgeMs = maxAgeMs;
  }

  filePath(origin, destination, date) {
    return path.join(this.directory, `${cacheKey(origin, destination, date)}.json`);
  }

  async get(origin, destination, date) {
    try {
      const file = this.filePath(origin, destination, date);
      const value = JSON.parse(await fs.readFile(file, 'utf8'));
      const fetchedAt = Date.parse(value.fetchedAt);
      const stale = !Number.isFinite(fetchedAt) || this.now() - fetchedAt > this.maxAgeMs;
      return { ...value, source: 'CACHE', stale };
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async put(origin, destination, date, payload) {
    await fs.mkdir(this.directory, { recursive: true });
    const file = this.filePath(origin, destination, date);
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify({ ...payload, fetchedAt: new Date(this.now()).toISOString() }, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, file);
    return payload;
  }
}
