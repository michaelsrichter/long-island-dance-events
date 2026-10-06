/**
 * The live server (decision P58): one Node process on Azure App Service that serves the website (Astro pages
 * made on request, and static files) and the /api endpoints. App Service sets PORT.
 */
import http from 'node:http';
import { route } from './app.js';
import { clientAddress, sendResponse, toRequest } from './lib/node-http.js';
import { closePool } from './lib/db.js';
import { appVersion } from './lib/http.js';

const port = Number(process.env.PORT || 8080);

const server = http.createServer(async (req, res) => {
  const startedAt = performance.now();
  try {
    const response = await route(toRequest(req), { clientAddress: clientAddress(req) });
    await sendResponse(req, res, response, { startedAt });
  } catch (err) {
    console.error(`[server] ${req.method} ${req.url}: ${err.stack || err.message}`);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Something went wrong on our side. Please try again in a minute.');
    } else {
      res.destroy();
    }
  }
});
// Longer than Azure's front end keeps idle connections open, so it never reuses a closed one.
server.keepAliveTimeout = 230_000;
server.headersTimeout = 235_000;

server.listen(port, () => console.log(`[server] version ${appVersion().commit} listening on ${port}`));

function stop(signal) {
  console.log(`[server] ${signal}: finishing open requests`);
  server.close(() => closePool().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.once('SIGTERM', () => stop('SIGTERM'));
process.once('SIGINT', () => stop('SIGINT'));
