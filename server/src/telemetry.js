/**
 * Monitoring (decision P62). Loaded first by main.js, before the server opens, so Application Insights records
 * every visit (the requests table) as well as the community code's own events. It starts the copy that the
 * /api code already has (api/src/telemetry-setup.js), so there is one copy in memory instead of two; App
 * Service's separate monitoring agent is off (infra/live/main.bicep). Nothing happens without
 * APPLICATIONINSIGHTS_CONNECTION_STRING.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { apiDir } from './lib/api-dir.js';

let on = false;
const dir = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ? apiDir() : null;
if (dir) {
  try {
    const require = createRequire(join(dir, 'package.json'));
    on = require(join(dir, 'src', 'telemetry-setup.js')).enabled;
    // The visit recorder attaches to Node's web modules the first time they are asked for after it starts.
    require('http');
    require('https');
  } catch (err) {
    console.warn(`[telemetry] could not start: ${err.message}`);
  }
}

/** For /api/health: is monitoring on? */
export const telemetryOn = () => on;
