// IndexNow from the live server (decision P61): only with indexing allowed, only the site's own addresses,
// in one batch, and a failed batch is tried once more.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { announce, enabled, flush, indexNowStatus } from '../src/indexnow.js';

const KEY = 'abcdef0123456789';
const set = (allow) => {
  process.env.ALLOW_INDEXING = allow ? 'true' : 'false';
  process.env.INDEXNOW_KEY = KEY;
  process.env.SITE_URL = 'https://longisland.dance';
};
afterEach(async () => {
  set(true);
  await flush({ fetchImpl: async () => new Response(null, { status: 200 }) }); // empty the queue
  delete process.env.ALLOW_INDEXING;
  delete process.env.INDEXNOW_KEY;
});

test('nothing is sent while search engines are kept out (before switch day)', async () => {
  set(false);
  assert.equal(enabled(), false);
  assert.equal(announce(['https://longisland.dance/events/']), 0);
  assert.equal(await flush({ fetchImpl: () => assert.fail('must not send') }), null);
});

test('changed addresses on the site go out together, with the key and where to find it', async () => {
  set(true);
  assert.equal(announce(['https://longisland.dance/events/', 'https://longisland.dance/venues/a/', 'https://elsewhere.example/x', 'not a url']), 2);
  assert.equal(announce(['https://longisland.dance/events/']), 0, 'already waiting');
  let sent;
  const status = await flush({
    fetchImpl: async (url, init) => {
      sent = { url, body: JSON.parse(init.body) };
      return new Response(null, { status: 202 });
    },
  });
  assert.equal(status, 202);
  assert.equal(sent.url, 'https://api.indexnow.org/indexnow');
  assert.deepEqual(sent.body, { host: 'longisland.dance', key: KEY, keyLocation: `https://longisland.dance/${KEY}.txt`, urlList: ['https://longisland.dance/events/', 'https://longisland.dance/venues/a/'] });
  assert.equal(indexNowStatus().queued, 0);
});

test('a refused batch is tried once more, then dropped', async () => {
  set(true);
  announce(['https://longisland.dance/towns/huntington/']);
  const refuse = async () => new Response(null, { status: 403 });
  await flush({ fetchImpl: refuse });
  assert.equal(indexNowStatus().queued, 1, 'queued again');
  await flush({ fetchImpl: refuse });
  assert.equal(indexNowStatus().queued, 0, 'not a third time');
});
