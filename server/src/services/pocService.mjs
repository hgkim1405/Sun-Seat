export class PocService {
  constructor(repository) {
    this.repository = repository;
  }

  getSummary() {
    return this.repository.getSummary();
  }

  getTimeline(resolution) {
    return this.repository.getTimeline(resolution);
  }

  getRoute() {
    return this.repository.getRoute();
  }
}

