import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryDir = path.dirname(fileURLToPath(import.meta.url));
const defaultResultsDir = path.resolve(repositoryDir, '../../../data/results/poc');
const defaultRouteDir = path.resolve(repositoryDir, '../../../data/processed/route');

export class PocRepository {
  constructor({ resultsDir = defaultResultsDir, routeDir = defaultRouteDir } = {}) {
    this.resultsDir = resultsDir;
    this.routeDir = routeDir;
  }

  async readJson(fileName, directory = this.resultsDir) {
    const filePath = path.join(directory, fileName);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        const missing = new Error(`PoC data is not available: ${filePath}`);
        missing.code = 'DATA_NOT_READY';
        throw missing;
      }
      throw error;
    }
  }

  getSummary() {
    return this.readJson('summary.json');
  }

  getTimeline(resolution) {
    const fileName = resolution === 'raw' ? 'timeline.json' : resolution === '5m' ? 'timeline-5m.json' : 'timeline-1m.json';
    return this.readJson(fileName);
  }

  getRoute() {
    return this.readJson('route.geojson', this.routeDir);
  }
}

