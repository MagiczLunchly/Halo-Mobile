const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../../tools/game_data_proxy.js'), 'utf8');
const load = async () => (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;
test('proxy streams fixed release range without exposing its redirect', async () => {
  const original = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://github.com/MagiczLunchly/Halo-Mobile/releases/download/halo-game-data-v1/halo-maps.bin.gz');
    assert.equal(options.redirect, 'follow');
    assert.equal(options.headers.Range, 'bytes=0-2');
    return new Response(new Uint8Array([1,2,3]), {status:206, headers:{'Content-Range':'bytes 0-2/1857797028'}});
  };
  try {
    const response = await (await load())(new Request('https://example.com/game-data', {headers:{Range:'bytes=0-2'}}));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Location'), null);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1,2,3]);
  } finally { global.fetch = original; }
});
test('proxy rejects missing, oversized and invalid ranges before fetching', async () => {
  const original = global.fetch;
  global.fetch = () => { throw Error('must not fetch'); };
  try {
    const handler = await load();
    for (const Range of ['', 'bytes=0-8388608', 'bytes=3-2', 'bytes=0-', 'bytes=1857797028-1857797029']) {
      assert.equal((await handler(new Request('https://example.com/game-data', {headers:{Range}}))).status,416);
    }
  } finally { global.fetch = original; }
});
test('proxy rejects upstream redirects or incorrect range responses', async () => {
  const original = global.fetch;
  try {
    const handler = await load();
    for (const status of [200,302,404]) {
      global.fetch = async () => new Response('bad', {status});
      assert.equal((await handler(new Request('https://example.com/game-data', {headers:{Range:'bytes=0-2'}}))).status,502);
    }
  } finally { global.fetch = original; }
});
