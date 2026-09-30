const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function map(name = 'ui.map') {
  const bytes = Buffer.alloc(4096);
  bytes.write('daeh', 0); bytes.writeUInt32LE(5, 4);
  bytes.writeUInt32LE(bytes.length, 8); bytes.write('toof', 2044);
  const blob = new Blob([bytes]); blob.name = name;
  return blob;
}
class Directory {
  constructor() { this.entries = new Map(); }
  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.entries.has(name)) {
      if (!create) throw new Error('not found');
      this.entries.set(name, new Directory());
    }
    const entry = this.entries.get(name);
    if (!(entry instanceof Directory)) throw new Error('not a directory');
    return entry;
  }
  async getFileHandle(name, { create = false } = {}) {
    if (!this.entries.has(name)) {
      if (!create) throw new Error('not found');
      this.entries.set(name, { bytes: Buffer.alloc(0), closed: false });
    }
    const file = this.entries.get(name);
    return { createSyncAccessHandle: async () => ({
      truncate: async () => { file.bytes = Buffer.alloc(0); },
      // Exercise partial writes.
      write: async (bytes, { at }) => {
        const count = Math.min(bytes.length, 71);
        if (at + count > file.bytes.length) {
          const grown = Buffer.alloc(at + count); file.bytes.copy(grown); file.bytes = grown;
        }
        Buffer.from(bytes).copy(file.bytes, at, 0, count);
        return count;
      },
      flush: async () => {},
      close: async () => { file.closed = true; },
    }) };
  }
}
function worker(fetch = () => { throw new Error('unexpected fetch'); }) {
  const root = new Directory(), messages = [];
  const context = vm.createContext({
    navigator: { storage: { getDirectory: async () => root,
      estimate: async () => ({ quota: 1e9, usage: 0 }) } },
    self: { location: { href: 'http://localhost:8081/xiso-worker.js', origin: 'http://localhost:8081' } },
    fetch, URL, TextEncoder, Uint8Array, postMessage: (message) => messages.push(message),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../site/xiso-worker.js'), 'utf8'), context);
  return { root, messages, send: (message) => context.onmessage({ data: message }) };
}
const target = ['games', 'maps-test'];
const message = (files) => ({ op: 'import-maps', target, files, name: 'Test maps' });
async function imported(w) {
  return (await (await w.root.getDirectoryHandle('games')).getDirectoryHandle('maps-test')).getDirectoryHandle('maps');
}
test('imports loose maps with partial writes and a complete manifest', async () => {
  const w = worker();
  const files = [map(), map('a10.map')];
  await w.send(message(files));
  assert.equal(w.messages.at(-1).type, 'done');
  const dir = await imported(w);
  const marker = JSON.parse(dir.entries.get('.complete').bytes.toString());
  assert.deepEqual(marker, { files: ['ui.map', 'a10.map'], bytes: 8192 });
  assert.equal(dir.entries.get('a10.map').bytes.length, 4096);
  assert.equal(dir.entries.get('.complete').closed, true);
});
for (const [name, files] of [
  ['missing ui.map', [map('a10.map')]],
  ['duplicate names', [map(), map('UI.MAP')]],
  ['unsafe path', [map(), map('../a10.map')]],
  ['invalid header', [new Blob([Buffer.alloc(4096)])]],
]) {
  test('rejects ' + name + ' without touching storage', async () => {
    const w = worker();
    await w.send(message(files));
    assert.equal(w.messages.at(-1).type, 'error');
    assert.equal(w.root.entries.size, 0);
  });
}
test('accepts compressed Xbox maps with a larger decompressed header length', async () => {
  const bytes = Buffer.from(await map().arrayBuffer());
  bytes.writeUInt32LE(8192, 8);
  const file = new Blob([bytes]); file.name = 'ui.map';
  const w = worker();
  await w.send(message([file]));
  assert.equal(w.messages.at(-1).type, 'done');
  const marker = JSON.parse((await imported(w)).entries.get('.complete').bytes.toString());
  assert.equal(marker.bytes, 4096);
});
test('never overwrites an existing maps installation', async () => {
  const w = worker();
  await w.send(message([map()]));
  const dir = await imported(w);
  const original = dir.entries.get('.complete').bytes.toString();
  await w.send(message([map(), map('a10.map')]));
  assert.equal(w.messages.at(-1).type, 'error');
  assert.equal(dir.entries.get('.complete').bytes.toString(), original);
});
test('streams same-origin local maps with partial writes', async () => {
  const file = map(), bytes = new Uint8Array(await file.arrayBuffer());
  const w = worker(async (url, options) => options.headers
    ? new Response(bytes.slice(0, 2048), { status: 206 })
    : new Response(bytes));
  await w.send({ op: 'import-maps', target, entries: [{ name: 'ui.map', size: bytes.length, url: '/downloaded-maps/ui.map' }] });
  assert.equal(w.messages.at(-1).type, 'done');
  assert.equal((await imported(w)).entries.get('ui.map').bytes.length, 4096);
});
test('rejects cross-origin sources before network or storage access', async () => {
  const w = worker();
  await w.send({ op: 'import-maps', target, entries: [{ name: 'ui.map', size: 4096, url: 'https://example.com/ui.map' }] });
  assert.equal(w.messages.at(-1).type, 'error');
  assert.equal(w.root.entries.size, 0);
});
test('leaves interrupted local copies without a completion marker', async () => {
  const file = map(), bytes = new Uint8Array(await file.arrayBuffer());
  const w = worker(async (url, options) => options.headers
    ? new Response(bytes.slice(0, 2048), { status: 206 })
    : new Response(bytes.slice(0, 2048)));
  await w.send({ op: 'import-maps', target, entries: [{ name: 'ui.map', size: bytes.length, url: '/downloaded-maps/ui.map' }] });
  assert.equal(w.messages.at(-1).type, 'error');
  assert.equal((await imported(w)).entries.has('.complete'), false);
});
