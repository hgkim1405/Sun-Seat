function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

function handleRepositoryError(response, error) {
  if (error?.code === 'DATA_NOT_READY') {
    sendJson(response, 503, { error: 'PoC data is not ready', detail: error.message });
    return;
  }
  console.error(error);
  sendJson(response, 500, { error: 'Internal server error' });
}

export class PocController {
  constructor(service) {
    this.service = service;
  }

  async summary(response) {
    try {
      sendJson(response, 200, await this.service.getSummary());
    } catch (error) {
      handleRepositoryError(response, error);
    }
  }

  async timeline(response, resolution) {
    try {
      sendJson(response, 200, await this.service.getTimeline(resolution));
    } catch (error) {
      handleRepositoryError(response, error);
    }
  }

  async route(response) {
    try {
      sendJson(response, 200, await this.service.getRoute());
    } catch (error) {
      handleRepositoryError(response, error);
    }
  }
}

