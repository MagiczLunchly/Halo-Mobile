'use strict';

// Stream to disk instead of holding a multi-gigabyte ISO in memory.
async function downloadIso(message, extractIso) {
  const url = new URL(message.url, self.location.href);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid ISO download URL.');
  const root = await navigator.storage.getDirectory();
  const temporary = await root.getDirectoryHandle('iso-download', { create: true });
  let reader, access;
  try {
    const response = await fetch(url.href, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok || !response.body) throw new Error('ISO download failed (HTTP ' + response.status + ').');
    const total = Number(response.headers.get('Content-Length')) || 0;
    const estimate = await navigator.storage.estimate();
    if (total && estimate.quota && total + 2.1e9 > estimate.quota - (estimate.usage || 0)) {
      throw new Error('Not enough browser storage for the ISO and extracted maps.');
    }
    const handle = await temporary.getFileHandle('game.iso', { create: true });
    access = await handle.createSyncAccessHandle();
    access.truncate(0);
    reader = response.body.getReader();
    let position = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      let written = 0;
      while (written < value.length) {
        const count = access.write(value.subarray(written), { at: position + written });
        if (!count) throw new Error('Could not save the ISO.');
        written += count;
      }
      position += value.length;
      postMessage({ type: 'progress', phase: 'download', done: position, total });
    }
    if (!position || (total && position !== total)) throw new Error('The ISO download was incomplete. Please retry.');
    access.flush();
    access.close();
    access = null;
    return await extractIso(await handle.getFile(), message.target, message.name);
  } finally {
    if (reader) await reader.cancel().catch(() => {});
    if (access) access.close();
    await temporary.removeEntry('game.iso').catch(() => {});
  }
}
