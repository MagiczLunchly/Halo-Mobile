const test = require('node:test');
const assert = require('node:assert/strict');
const { streamedMapsGame } = require('../site/stream-maps.js');
const entry = (name = 'ui.map') => ({ name, size: 4096, url: '/downloaded-maps/' + name });
test('builds a virtual library entry without fetching maps or writing OPFS', () => {
  const game = streamedMapsGame({ files: [entry(), entry('a10.map')] });
  assert.equal(game.streamed, true);
  assert.equal(game.dataRoot, '/data/streamed');
  assert.deepEqual(game.path, ['streamed']);
  assert.deepEqual(game.files, ['ui.map', 'a10.map']);
  assert.equal(game.bytes, 8192);
});
for (const [name, files] of [
  ['empty list', []], ['missing ui', [entry('a10.map')]],
  ['duplicate', [entry(), entry()]], ['traversal', [entry(), entry('../a.map')]],
  ['uppercase', [entry('UI.MAP')]], ['remote URL', [{ ...entry(), url: 'https://example.com/ui.map' }]],
  ['fractional length', [{ ...entry(), size: 2048.5 }]], ['small file', [{ ...entry(), size: 100 }]],
  ['too many maps', Array.from({length:257}, (_, i) => entry(i ? 'a' + i + '.map' : 'ui.map'))],
]) test('rejects ' + name, () => assert.throws(() => streamedMapsGame({ files })));
