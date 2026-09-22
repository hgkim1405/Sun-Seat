import http from 'node:http';

import { createRequestHandler } from './app/createApp.mjs';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const requestHandler = createRequestHandler();
const server = http.createServer((request, response) => {
  requestHandler(request, response).catch((error) => {
    console.error(error);
    if (!response.headersSent) {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    }
    response.end(JSON.stringify({ error: 'Internal server error' }));
  });
});

server.listen(port, host, () => {
  console.log(JSON.stringify({ event: 'startup', service: 'sunseat-api', host, port }));
});
