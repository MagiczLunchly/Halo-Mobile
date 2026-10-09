const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = vm.createContext({ Headers, Response, URL,
  self: { addEventListener() {} } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../site/sw.js'), 'utf8'), context);

for (const pathname of ['/', '/index.html']) {
  test('allows cross-site embedding of launcher navigation ' + pathname, () => {
    const response = context.isolated(new Response('launcher'), {
      mode: 'navigate', url: 'https://halo.example' + pathname,
    });
    assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin');
    assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
    assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  });
}

test('keeps non-launcher resources and ordinary fetches restricted', () => {
  for (const [pathname, mode] of [['/halo.wasm', 'cors'], ['/local-maps.json', 'cors'],
    ['/other.html', 'navigate'], ['/index.html', 'cors']]) {
    const response = context.isolated(new Response('resource'), {
      mode, url: 'https://halo.example' + pathname,
    });
    assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
  }
});

