const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { gzipSync } = require('node:zlib');

class Directory {
  constructor() { this.entries = new Map(); }
  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.entries.has(name)) {
      if (!create) throw new Error('missing');
      this.entries.set(name, new Directory());
    }
    return this.entries.get(name);
  }
  async getFileHandle(name) {
    const file = { bytes: Buffer.alloc(0), closed: false };
    this.entries.set(name, file);
    return { createSyncAccessHandle: async () => ({
      truncate() {}, flush() {}, close() { file.closed = true; },
      write(bytes, { at }) {
        const count = Math.min(bytes.length, 71);
        const grown = Buffer.alloc(Math.max(file.bytes.length, at + count));
        file.bytes.copy(grown); Buffer.from(bytes).copy(grown, at, 0, count);
        file.bytes = grown; return count;
      },
    }) };
  }
}

function map() {
  const bytes = Buffer.alloc(4096, 7);
  bytes.write('daeh', 0); bytes.writeUInt32LE(5, 4);
  bytes.writeUInt32LE(4096, 8); bytes.write('toof', 2044);
  return bytes;
}
function worker(archive, quota = 1e10, status = 200) {
  const root = new Directory(), messages = [];
  let fetched = 0;
  const context = vm.createContext({ URL, TransformStream, DecompressionStream, ReadableStream, AbortController, setTimeout, TextEncoder, Uint8Array,
    self: { location: { href: 'https://example.com/halo-mobile/xiso-worker.js', origin: 'https://example.com' } },
    navigator: { storage: { getDirectory: async () => root, estimate: async () => ({ quota, usage: 0 }) } },
    fetch: async () => {
      fetched++;
      let offset = 0;
      return new Response(new ReadableStream({ pull(controller) {
        if (offset === archive.length) { controller.close(); return; }
        const end = Math.min(offset + 13, archive.length);
        controller.enqueue(new Uint8Array(archive.subarray(offset, end))); offset = end;
      } }), { status });
    },
    postMessage: message => messages.push(message),
  });
  context.importScripts = name => vm.runInContext(fs.readFileSync(path.join(__dirname, '../site', name), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../site/xiso-worker.js'), 'utf8'), context);
  return { root, messages, fetched: () => fetched, send: message => context.onmessage({ data: message }) };
}
function message(archive) {
  return { op: 'download-maps', url: 'https://example.com/halo-mobile/game-data/maps.gz',
    target: ['games', 'download-test'], name: 'Halo CE', downloadBytes: archive.length,
    files: [{ name: 'ui.map', size: 4096 }, { name: 'a10.map', size: 4096 }] };
}
async function installation(w) {
  return (await (await w.root.getDirectoryHandle('games')).getDirectoryHandle('download-test')).getDirectoryHandle('maps');
}

test('downloads and decompresses maps with chunk boundaries and partial writes', async () => {
  const bytes = map(), archive = gzipSync(Buffer.concat([bytes, bytes]));
  const w = worker(archive);
  await w.send(message(archive));
  assert.equal(w.messages.at(-1).type, 'done', w.messages.at(-1).message);
  const maps = await installation(w);
  for (const name of ['ui.map', 'a10.map']) {
    assert.deepEqual(maps.entries.get(name).bytes, bytes);
    assert.equal(maps.entries.get(name).closed, true);
  }
  const marker = JSON.parse(maps.entries.get('.complete').bytes.toString());
  assert.deepEqual(marker, { files: ['ui.map', 'a10.map'], bytes: 8192 });
  assert.equal(w.messages.filter(m => m.type === 'progress').at(-1).done, archive.length);
});

test('rejects corrupt, truncated, and oversized packs without committing an installation', async () => {
  for (const bytes of [Buffer.concat([Buffer.alloc(4096), map()]), map(), Buffer.concat([map(), map(), Buffer.from('extra')])]) {
    const archive = gzipSync(bytes), w = worker(archive);
    await w.send(message(archive));
    assert.equal(w.messages.at(-1).type, 'error');
    assert.equal((await installation(w)).entries.has('.complete'), false);
  }
});

test('rejects cross-site URLs and insufficient storage before downloading', async () => {
  const archive = gzipSync(Buffer.concat([map(), map()]));
  for (const [quota, remote] of [[1, false], [1e10, true]]) {
    const w = worker(archive, quota), m = message(archive);
    if (remote) m.url = 'https://other.example/maps.gz';
    await w.send(m);
    assert.equal(w.messages.at(-1).type, 'error');
    assert.equal(w.fetched(), 0);
    assert.equal(w.root.entries.size, 0);
  }
});

test('never replaces an existing installation on retry', async () => {
  const archive = gzipSync(Buffer.concat([map(), map()])), w = worker(archive);
  await w.send(message(archive));
  await w.send(message(archive));
  assert.equal(w.messages.at(-1).type, 'error');
  assert.equal(w.fetched(), 1);
  assert.equal((await installation(w)).entries.has('.complete'), true);
});

test('retries a dropped range from the last delivered byte without duplicating data', async () => {
  const bytes = Buffer.from('abcdefghijklmnopqrstuvwxyz'), requests = [];
  const context = vm.createContext({ ReadableStream, AbortController, setTimeout: callback => callback(),
    fetch: async (_url, options) => {
      const start = Number(options.headers.Range.match(/bytes=(\d+)/)[1]);
      requests.push(start);
      let sent = false;
      const body = requests.length === 1 ? new ReadableStream({ pull(controller) {
        if (!sent) { sent = true; controller.enqueue(new Uint8Array(bytes.subarray(0, 7))); }
        else controller.error(new Error('Connection dropped'));
      } }, { highWaterMark: 0 }) : new Blob([bytes.subarray(start)]).stream();
      return new Response(body, { status: 206, headers: {
        'Content-Range': `bytes ${start}-${bytes.length - 1}/${bytes.length}`,
      } });
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../site/maps-download.js'), 'utf8'), context);
  const actual = await new Response(context.mapPackRanges('https://example.com/pack.gz', bytes.length)).arrayBuffer();
  assert.deepEqual(Buffer.from(actual), bytes);
  assert.deepEqual(requests, [0, 7]);
});
