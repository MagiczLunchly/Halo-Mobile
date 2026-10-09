// Follow the release asset redirect on the server so browser downloads stay same-origin.
const SOURCE = 'https://github.com/MagiczLunchly/Halo-Mobile/releases/download/halo-game-data-v1/halo-maps.bin.gz';
const SIZE = 1857797028;
const CHUNK = 8 * 1024 * 1024;

export default async function download(request) {
  const headers = {
    'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Accept-Ranges': 'bytes',
    'Content-Type': 'application/octet-stream',
  };
  if (request.method !== 'GET') {
    return new Response('Use GET with a byte range.', {status: 405, headers: {...headers, Allow: 'GET'}});
  }
  const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.get('Range') || '');
  const start = range ? Number(range[1]) : -1;
  const end = range ? Number(range[2]) : -1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= SIZE || end - start + 1 > CHUNK) {
    return new Response('Request a range of at most 8 MiB.', {status: 416, headers: {...headers, 'Content-Range': `bytes */${SIZE}`}});
  }
  try {
    const upstream = await fetch(SOURCE, {
      headers: {Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity'},
      redirect: 'follow', signal: request.signal,
    });
    const expected = `bytes ${start}-${end}/${SIZE}`;
    if (upstream.status !== 206 || upstream.headers.get('Content-Range') !== expected || !upstream.body) {
      if (upstream.body) await upstream.body.cancel();
      return new Response('Download temporarily unavailable. Retry shortly.', {status: 502, headers});
    }
    return new Response(upstream.body, {status: 206, headers: {
      ...headers, 'Content-Range': expected, 'Content-Length': String(end - start + 1),
    }});
  } catch {
    return new Response('Download temporarily unavailable. Retry shortly.', {status: 502, headers});
  }
}
