const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('place both launch actions above checks and game-data options', () => {
  const html = fs.readFileSync(path.join(__dirname, '../site/index.html'), 'utf8');
  const launcher = html.slice(html.indexOf('<main id="launcher">'));
  for (const id of ['play', 'play-streamed-maps']) {
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1);
    const position = launcher.indexOf('id="' + id + '"');
    assert.ok(position > launcher.indexOf('</header>'));
    assert.ok(position < launcher.indexOf('id="checks"'));
    assert.ok(position < launcher.indexOf('id="step-data"'));
  }
  assert.match(html, /id="step-play" class="step" hidden/);
  assert.match(html, /id="play-streamed-maps" type="button" hidden/);
});

test('open the launcher without a first-visit installation screen', () => {
  const html = fs.readFileSync(path.join(__dirname, '../site/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../site/app.js'), 'utf8');
  assert.doesNotMatch(html, /id="welcome"|id="welcome-skip"|id="install-ios"|id="install-droid"/);
  assert.doesNotMatch(app, /halo-web-welcomed|setUpWelcome/);
  assert.match(app, /setUpInstallGuides\(\);/);
  for (const id of ['sheet-ios', 'sheet-droid', 'install-hint-how', 'install-android-how']) {
    assert.ok(html.includes('id="' + id + '"'));
  }
});
