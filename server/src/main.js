/**
 * The live server (decision P58): one Node process on Azure App Service that serves the website (Astro pages
 * made on request, and static files) and the /api endpoints. App Service sets PORT.
 */
import http from 'node:http';
import { route } from './app.js';
import { clientAddress, sendResponse, toRequest } from './lib/node-http.js';
import { closePool } from './lib/db.js';
import { startLiveData } from './live-data.js';
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

/** The busiest pages; kept prepared so visitors don't wait for them (pages are remembered for 15 minutes). */
const BUSIEST = ['/', '/events/'];
const host = process.env.CANONICAL_HOST || 'longisland.dance';

async function prepare(log) {
  for (const path of BUSIEST) {
    const started = performance.now();
    try {
      const res = await route(new Request(`https://${host}${path}`), {});
      await res.arrayBuffer();
      if (log) console.log(`[server] prepared ${path} (${res.status}, ${Math.round(performance.now() - started)} ms)`);
    } catch (err) {
      console.warn(`[server] could not prepare ${path}: ${err.message}`);
    }
  }
}

/**
 * After a start: load the records from the database (then every 2 seconds, check for changes), and prepare
 * the busiest pages so the first visitors don't wait. If the database is slow to answer, the pages are
 * prepared from the records the site was built with, and again once the database answers.
 */
async function warmUp() {
  installSitemapState();
  const { first } = startLiveData({ onLoaded: () => prepare(false) });
  const loaded = await Promise.race([first, new Promise((r) => setTimeout(() => r(false), 30_000).unref())]);
  if (!loaded) await prepare(true);
}

server.listen(port, () => {
  console.log(`[server] version ${appVersion().commit} listening on ${port}`);
  warmUp();
  // Again every 10 minutes: also covers a new day starting on Long Island.
  setInterval(() => prepare(false), 10 * 60_000).unref();
});

function stop(signal) {
  console.log(`[server] ${signal}: finishing open requests`);
  server.close(() => closePool().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.once('SIGTERM', () => stop('SIGTERM'));
process.once('SIGINT', () => stop('SIGINT'));
