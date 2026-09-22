import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryDir = path.dirname(fileURLToPath(import.meta.url));
const metadataDir = path.resolve(repositoryDir, '../../../data/metadata');

export class MetadataRepository {
  constructor({ directory = metadataDir, env = process.env } = {}) {
    this.directory = directory;
    this.stationCodes = {};
    if (env.SUNSEAT_STATION_CODES_JSON) {
      try {
        this.stationCodes = JSON.parse(env.SUNSEAT_STATION_CODES_JSON);
      } catch {
        throw new Error('SUNSEAT_STATION_CODES_JSON must be valid JSON');
      }
    }
    this.stationData = null;
    this.tagoStationData = null;
    this.trainTypeData = null;
    this.rollingStockData = null;
    this.sourceData = null;
  }

  async loadStations() {
    if (!this.stationData) {
      this.stationData = JSON.parse(await fs.readFile(path.join(this.directory, 'stations.json'), 'utf8'));
    }
    return this.stationData;
  }

  async loadTagoStations() {
    if (!this.tagoStationData) {
      try {
        this.tagoStationData = JSON.parse(await fs.readFile(path.join(this.directory, 'tago-stations.json'), 'utf8'));
      } catch (error) {
        if (error?.code === 'ENOENT') this.tagoStationData = { stations: [] };
        else throw error;
      }
    }
    return this.tagoStationData;
  }

  async loadSources() {
    if (!this.sourceData) {
      this.sourceData = JSON.parse(await fs.readFile(path.join(this.directory, 'sources.json'), 'utf8'));
    }
    return this.sourceData;
  }

  async loadTrainTypes() {
    if (!this.trainTypeData) {
      this.trainTypeData = JSON.parse(await fs.readFile(path.join(this.directory, 'train-types.json'), 'utf8'));
    }
    return this.trainTypeData;
  }

  async loadRollingStocks() {
    if (!this.rollingStockData) {
      try {
        this.rollingStockData = JSON.parse(await fs.readFile(path.resolve(this.directory, '..', 'rolling-stock', 'rolling-stock.json'), 'utf8'));
      } catch (error) {
        if (error?.code === 'ENOENT') this.rollingStockData = { rollingStocks: [] };
        else throw error;
      }
    }
    return this.rollingStockData;
  }

  async findStations(query = '') {
    const data = await this.loadStations();
    const tagoData = await this.loadTagoStations();
    const routeStations = data.stations.map((station) => ({
      ...station,
      routeId: data.routeId,
      isRouteAnchor: true,
      tagoCode: this.stationCodes[station.id] ?? station.tagoCode,
    }));
    const routeByCode = new Map(routeStations.filter((station) => station.tagoCode).map((station) => [station.tagoCode, station]));
    const routeByName = new Map(routeStations.map((station) => [station.name, station]));
    const nationwideStations = (tagoData.stations ?? []).map((station) => {
      const routeStation = routeByCode.get(station.id) ?? routeByName.get(station.name);
      if (routeStation) return routeStation;
      return {
        id: `tago-${station.id.toLowerCase()}`,
        name: station.name,
        aliases: station.aliases ?? [station.name],
        osmName: station.name,
        tagoCode: station.id,
        korailCode: null,
        cityCode: station.cityCode,
        cityName: station.cityName,
        routeId: null,
        isRouteAnchor: false,
      };
    });
    const merged = [...routeStations, ...nationwideStations.filter((station) => !routeByCode.has(station.tagoCode) && !routeByName.has(station.name))];
    const normalized = query.trim().toLocaleLowerCase('ko-KR');
    return merged.filter((station) => {
      if (!normalized) return true;
      return [station.name, station.id, station.osmName, ...station.aliases]
        .some((value) => String(value).toLocaleLowerCase('ko-KR').includes(normalized));
    });
  }

  async findStation(value) {
    const stations = await this.findStations(value);
    const normalized = value.trim().toLocaleLowerCase('ko-KR');
    return stations.find((station) => station.id === normalized || station.name === value || station.tagoCode === value || station.aliases.includes(value)) ?? null;
  }

  async routeVersion() {
    const sources = await this.loadSources();
    return sources.railwaySource.routeVersion;
  }
}
