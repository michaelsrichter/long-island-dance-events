/**
 * The live server (decision P58): one Node process on Azure App Service that serves the website (Astro pages
 * made on request, and static files) and the /api endpoints. App Service sets PORT.
 */
import http from 'node:http';
import { route } from './app.js';
import { clientAddress, sendResponse, toRequest } from './lib/node-http.js';
import { closePool } from './lib/db.js';
import { startLiveData } from './live-data.js';
import { prepareAll } from './prepare.js';
import { installSitemapState } from './sitemap-state.js';
import { appVersion } from './lib/http.js';

const port = Number(process.env.PORT || 8080);
/** For logs: no line breaks or other control characters from a visitor, and not too long. */
const safe = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300);

const server = http.createServer(async (req, res) => {
  const startedAt = performance.now();
  try {
    const response = await route(toRequest(req), { clientAddress: clientAddress(req) });
    await sendResponse(req, res, response, { startedAt });
  } catch (err) {
    console.error(`[server] ${safe(req.method)} ${safe(req.url)}: ${err.stack || err.message}`);
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

const nyDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

/**
 * After a start: load the records from the database (then every 2 seconds, check for changes), and prepare
 * every page so nobody waits for one to be made (prepare.js). If the database is slow to answer, the pages
 * are prepared from the records the site was built with, and again once the database answers.
 */
async function warmUp() {
  installSitemapState();
  const { first } = startLiveData({ onLoaded: () => prepareAll('new data') });
  const loaded = await Promise.race([first, new Promise((r) => setTimeout(() => r(false), 30_000).unref())]);
  if (!loaded) await prepareAll('start');
}

server.listen(port, () => {
  console.log(`[server] version ${appVersion().commit} listening on ${port}`);
  warmUp();
  // A new day on Long Island changes "upcoming" and "today" everywhere: prepare every page again.
  let day = nyDay();
  setInterval(() => {
    if (nyDay() !== day) {
      day = nyDay();
      prepareAll('new day');
    }
  }, 60_000).unref();
});

function stop(signal) {
  console.log(`[server] ${signal}: finishing open requests`);
  server.close(() => closePool().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.once('SIGTERM', () => stop('SIGTERM'));
process.once('SIGINT', () => stop('SIGINT'));
