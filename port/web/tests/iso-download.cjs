const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(response, quota = 20e9) {
  let bytes = Buffer.alloc(0), deleted = false, closed = false;
  const progress = [];
  const handle = {
    getFile: async () => new Blob([bytes]),
    createSyncAccessHandle: async () => ({
      truncate: () => { bytes = Buffer.alloc(0); },
      write: (chunk, { at }) => {
        const count = Math.min(2, chunk.length);
        const grown = Buffer.alloc(at + count); bytes.copy(grown);
        Buffer.from(chunk).copy(grown, at, 0, count); bytes = grown;
        return count;
      },
      flush() {}, close() { closed = true; },
    }),
  };
  const temp = { getFileHandle: async () => handle, removeEntry: async () => { deleted = true; } };
  const context = vm.createContext({ URL,
    self: { location: { href: 'https://example.com/xiso-worker.js' } },
    navigator: { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => temp }),
      estimate: async () => ({ quota, usage: 0 }) } },
    fetch: async () => response, postMessage: (message) => progress.push(message),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../site/iso-download.js'), 'utf8'), context);
  return { context, progress, deleted: () => deleted, closed: () => closed };
}

test('streams ISO with partial disk writes, then extracts and deletes temporary data', async () => {
  const w = setup(new Response('test ISO', { headers: { 'Content-Length': '8' } }));
  const result = await w.context.downloadIso({ url: '/game.iso', target: ['games', 'test'], name: 'Halo' },
    async (file, target, name) => {
      assert.equal(await file.text(), 'test ISO');
      assert.deepEqual(target, ['games', 'test']);
      assert.equal(name, 'Halo');
      assert.equal(w.closed(), true);
      return { files: 1 };
    });
  assert.equal(result.files, 1);
  assert.equal(w.progress.at(-1).done, 8);
  assert.equal(w.deleted(), true);
});

test('rejects truncated downloads and cleans up without extracting', async () => {
  const w = setup(new Response('short', { headers: { 'Content-Length': '10' } }));
  await assert.rejects(w.context.downloadIso({ url: '/game.iso' }, () => assert.fail('must not extract')), /incomplete/);
  assert.equal(w.deleted(), true);
  assert.equal(w.closed(), true);
});

test('cleans temporary ISO after extraction failure', async () => {
  const w = setup(new Response('invalid ISO'));
  await assert.rejects(w.context.downloadIso({ url: '/game.iso' }, async () => { throw new Error('Invalid ISO'); }), /Invalid ISO/);
  assert.equal(w.deleted(), true);
});

test('rejects download errors and insufficient storage', async () => {
  for (const [response, quota, error] of [
    [new Response('', { status: 404 }), 20e9, /HTTP 404/],
    [new Response('ISO', { headers: { 'Content-Length': '3' } }), 1e9, /Not enough/],
  ]) {
    const w = setup(response, quota);
    await assert.rejects(w.context.downloadIso({ url: '/game.iso' }, () => assert.fail()), error);
    assert.equal(w.deleted(), true);
  }
});
