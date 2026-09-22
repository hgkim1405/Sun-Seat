import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryDir = path.dirname(fileURLToPath(import.meta.url));
const defaultProcessedDir = path.resolve(repositoryDir, '../../../data/processed');

export class RouteRepository {
  constructor({ directory = null, processedDirectory = defaultProcessedDir, maxFeatures = 900 } = {}) {
    this.directory = directory;
    this.processedDirectory = processedDirectory;
    this.maxFeatures = maxFeatures;
  }

  async getDisplay(routeId) {
    if (routeId !== 'seoul-busan') {
      const error = new Error(`Route dataset is not available: ${routeId}`);
      error.code = 'ROUTE_NOT_FOUND';
      throw error;
    }
    let routeDirectory = this.directory;
    if (!routeDirectory) {
      try {
        const active = JSON.parse(await fs.readFile(path.join(this.processedDirectory, 'active.json'), 'utf8'));
        routeDirectory = path.join(this.processedDirectory, active.routeRoot);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        routeDirectory = path.join(this.processedDirectory, 'route');
      }
    }
    const value = JSON.parse(await fs.readFile(path.join(routeDirectory, 'route.geojson'), 'utf8'));
    const step = Math.max(1, Math.ceil(value.features.length / this.maxFeatures));
    return {
      type: 'FeatureCollection',
      features: value.features.filter((_, index) => index % step === 0 || index === value.features.length - 1),
      properties: { routeId, attribution: '© OpenStreetMap contributors', simplified: step > 1 },
    };
  }
}
