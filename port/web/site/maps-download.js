'use strict';

// Keep requests small and retry from the last delivered byte. The gzip decoder
// stays alive, so a dropped request doesn't restart the whole installation.
function mapPackRanges(url, total) {
  let position = 0, reader = null, end = 0, retries = 0;
  const abort = new AbortController();
  return new ReadableStream({
    async pull(controller) {
      while (true) {
        if (position === total) { controller.close(); return; }
        try {
          if (!reader) {
            end = Math.min(position + 8 * 1024 * 1024, total);
            const response = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: abort.signal,
              headers: { Range: `bytes=${position}-${end - 1}` } });
            if (!response.ok || !response.body) throw new Error('Game download failed (HTTP ' + response.status + ').');
            if (response.status === 206) {
              const range = response.headers.get('Content-Range');
              if (range !== `bytes ${position}-${end - 1}/${total}`) throw new Error('The game server returned an incorrect download range.');
            } else if (position === 0 && response.status === 200) {
              end = total; // A server without ranges can still supply the full pack.
            } else {
              throw new Error('The game server cannot resume this download.');
            }
            reader = response.body.getReader();
          }
          const next = await reader.read();
          if (next.done) throw new Error('The connection stopped early.');
          if (position + next.value.length > end) throw new Error('The game server returned extra data.');
          position += next.value.length;
          retries = 0;
          if (position === end) { await reader.cancel().catch(() => {}); reader = null; }
          controller.enqueue(next.value);
          return;
        } catch (error) {
          if (reader) await reader.cancel().catch(() => {});
          reader = null;
          if (abort.signal.aborted || ++retries > 3) { controller.error(error); return; }
          await new Promise(resolve => setTimeout(resolve, 500 * 2 ** retries));
        }
      }
    },
    async cancel() { abort.abort(); if (reader) await reader.cancel().catch(() => {}); },
  });
}

// Decode one compressed stream directly into OPFS: no ISO or archive copy on disk.
async function downloadMapPack(message) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Update your browser to download this game.');
  const url = new URL(message.url, self.location.href);
  if (url.origin !== self.location.origin) throw new Error('Download game data from this website only.');
  const files = message.files;
  if (!Array.isArray(files) || !files.length || files.length > 128) throw new Error('Invalid game download manifest.');
  const names = new Set();
  let installedBytes = 0;
  for (const file of files) {
    if (!/^[a-z0-9_-]+\.map$/.test(file.name) || names.has(file.name) ||
        !Number.isSafeInteger(file.size) || file.size < 2048 || file.size > 0x40000000) {
      throw new Error('Invalid downloaded map.');
    }
    names.add(file.name);
    installedBytes += file.size;
  }
  if (!names.has('ui.map')) throw new Error('The download must include ui.map.');
  if (!Array.isArray(message.target) || message.target.length !== 2 || message.target[0] !== 'games' ||
      !/^download-[a-z0-9-]+$/.test(message.target[1])) throw new Error('Download into a new installation.');
  const estimate = await navigator.storage.estimate();
  if (estimate.quota && installedBytes > estimate.quota - (estimate.usage || 0)) {
    throw new Error('Not enough browser storage. Free up at least ' + (installedBytes / 1e9).toFixed(2) + ' GB and retry.');
  }
  const base = await folder(message.target, true);
  let exists = false;
  try { await base.getDirectoryHandle('maps'); exists = true; } catch { /* new installation */ }
  if (exists) throw new Error('This installation already exists.');
  const directory = await base.getDirectoryHandle('maps', { create: true });
  let networkBytes = 0, lastReport = 0, currentFile = files[0].name;
  const total = Number(message.downloadBytes) || 0;
  let body;
  if (message.rangeDownload && Number.isSafeInteger(total) && total > 0) {
    body = mapPackRanges(url.href, total);
  } else {
    const response = await fetch(url.href, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok || !response.body) throw new Error('Game download failed (HTTP ' + response.status + ').');
    body = response.body;
  }
  function report(force = false) {
    if (!force && Date.now() - lastReport < 200) return;
    lastReport = Date.now();
    postMessage({ type: 'progress', phase: 'download', file: currentFile, done: networkBytes, total });
  }
  const reader = body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      networkBytes += chunk.length;
      if (total && networkBytes > total) throw new Error('The download size changed.');
      report();
      controller.enqueue(chunk);
    },
  })).pipeThrough(new DecompressionStream('gzip')).getReader();
  let pending = new Uint8Array(0), offset = 0;
  try {
    for (const file of files) {
      currentFile = file.name;
      const handle = await directory.getFileHandle(file.name, { create: true });
      const access = await handle.createSyncAccessHandle();
      const header = new Uint8Array(2048);
      let position = 0;
      try {
        await access.truncate(0);
        while (position < file.size) {
          if (offset === pending.length) {
            const next = await reader.read();
            if (next.done) throw new Error('The download stopped early. Please retry.');
            pending = next.value;
            offset = 0;
          }
          const count = Math.min(file.size - position, pending.length - offset);
          const bytes = pending.subarray(offset, offset + count);
          if (position < header.length) header.set(bytes.subarray(0, Math.min(count, header.length - position)), position);
          let written = 0;
          while (written < bytes.length) {
            const n = await access.write(bytes.subarray(written), { at: position + written });
            if (!n) throw new Error('Cannot save ' + file.name);
            written += n;
          }
          position += count;
          offset += count;
        }
        if (text(header, 0, 4) !== 'daeh' || u32(header, 4) !== 5 ||
            u32(header, 8) < file.size || u32(header, 8) > 0x40000000 || text(header, 2044, 4) !== 'toof') {
          throw new Error('Invalid Halo map: ' + file.name);
        }
        await access.flush();
      } finally { await access.close(); }
      report(true);
    }
    if (offset !== pending.length || !(await reader.read()).done || (total && networkBytes !== total)) {
      throw new Error('The game download has an unexpected size.');
    }
    await writeInfo(base, { name: message.name || 'Halo CE', source: 'Automatic download', added: Date.now() });
    await writeInfo(directory, { files: files.map(file => file.name), bytes: installedBytes }, COMPLETE_MARKER);
    return { files: files.length, bytes: installedBytes };
  } finally { await reader.cancel().catch(() => {}); }
}
