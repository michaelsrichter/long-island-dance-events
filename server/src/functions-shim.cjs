'use strict';
/**
 * Stand-in for '@azure/functions' when the community /api code runs inside the live server (decision P60).
 * The /api files (api/src/functions/*.js) call app.http(name, { methods, route, handler }) when they load;
 * this only writes those down, and server/src/api-adapter.js answers the requests with the same handlers.
 */
const routes = (globalThis.__liApiRoutes ??= []);

const app = {
  http(name, options) {
    routes.push({ name, ...options });
  },
  // Not used by the /api code; present so a stray call doesn't stop the server.
  timer() {},
  setup() {},
  hook: { appStart() {}, appTerminate() {}, preInvocation() {}, postInvocation() {} },
};

module.exports = { app };
