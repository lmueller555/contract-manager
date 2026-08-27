'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const childProcess = require('node:child_process');

test('Python scraper bridge exchanges a JSON request and response', async t => {
  const original = childProcess.spawn;
  // Load after replacing spawn because the bridge destructures it at import time.
  childProcess.spawn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    let request = '';
    child.stdin.on('data', chunk => { request += chunk; });
    child.stdin.on('finish', () => {
      assert.deepEqual(JSON.parse(request), { url: 'https://example.com', maxPages: 2 });
      child.stdout.end(JSON.stringify({ pages: [{ url: 'https://example.com' }] }));
      child.emit('close', 0);
    });
    return child;
  };
  t.after(() => { childProcess.spawn = original; delete require.cache[require.resolve('../src/playwright-scraper')]; });
  delete require.cache[require.resolve('../src/playwright-scraper')];
  const { scrapeWithPlaywright } = require('../src/playwright-scraper');
  const result = await scrapeWithPlaywright({ url: 'https://example.com', maxPages: 2 });
  assert.equal(result.pages[0].url, 'https://example.com');
});
