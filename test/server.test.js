'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { app, scanError } = require('../src/server');

test('starts a PDF scan asynchronously and exposes its result as JSON', async t => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const server = app.listen(0);
  t.after(() => {
    server.close();
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  const { port } = server.address();
  const form = new FormData();
  form.append('document', new Blob(['%PDF sample'], { type: 'application/pdf' }), 'sample.pdf');
  const startedResponse = await fetch(`http://127.0.0.1:${port}/api/documents/scan`, {
    method: 'POST',
    body: form
  });
  const started = await startedResponse.json();

  assert.equal(startedResponse.status, 202);
  assert.match(startedResponse.headers.get('content-type'), /^application\/json/);
  assert.equal(started.status, 'processing');
  assert.match(started.id, /^[0-9a-f-]{36}$/);

  await new Promise(resolve => setImmediate(resolve));
  const resultResponse = await fetch(`http://127.0.0.1:${port}/api/documents/scan/${started.id}`);
  const result = await resultResponse.json();
  assert.equal(resultResponse.status, 200);
  assert.match(resultResponse.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(result, {
    status: 'failed',
    error: 'Document intelligence is not configured. Set OPENAI_API_KEY and try again.'
  });
});

test('maps scanner failures to user-safe messages', () => {
  const error = Object.assign(new Error('upstream HTML was not JSON'), { status: 502 });
  assert.deepEqual(scanError(error), {
    httpStatus: 502,
    message: 'The AI could not scan that PDF. Confirm it is valid and try again.'
  });
});
