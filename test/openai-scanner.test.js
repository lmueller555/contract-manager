'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MODEL, scanPdf } = require('../src/openai-scanner');

const analysis = {
  document: { solicitation: '4TX1037', location: 'Rosenberg, TX', dueDate: 'September 15, 2026' },
  space: {
    aboaSquareFeet: '38,685',
    parkingSpaces: '3',
    leaseTerm: '20 years, 15 years firm',
    tenantImprovementAllowance: '49.13',
    securityAllowance: '12.00'
  },
  boundaries: { north: 'I-10', south: 'Westpark Tollway', east: 'Beltway 8', west: 'Grand Parkway' },
  requirements: ['Contiguous space', 'Loading bay or dock'],
  statement: 'The Government seeks contiguous office space with loading access.',
  confidence: 'High'
};

test('sends the PDF directly to GPT-5 mini and returns dashboard data', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(analysis) }] }] })
    };
  };

  const result = await scanPdf(Buffer.from('%PDF sample'), { fileName: 'sample.pdf' }, {
    apiKey: 'test-key', fetchImpl
  });

  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  assert.equal(request.body.model, MODEL);
  assert.equal(MODEL, 'gpt-5-mini');
  assert.equal(request.body.text.format.type, 'json_schema');
  assert.equal(request.body.text.format.strict, true);
  const file = request.body.input[0].content.find(item => item.type === 'input_file');
  assert.equal(file.filename, 'sample.pdf');
  assert.match(file.file_data, /^data:application\/pdf;base64,/);
  assert.equal(result.document.fileName, 'sample.pdf');
  assert.equal(result.document.pages, null);
  assert.deepEqual(result.requirements, analysis.requirements);
});

test('requires the Heroku OPENAI_API_KEY configuration', async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(scanPdf(Buffer.from('pdf')), /OPENAI_API_KEY is not configured/);
  } finally {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test('surfaces an OpenAI API error without accepting an empty result', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: { message: 'Rate limit reached.' } })
  });

  await assert.rejects(
    scanPdf(Buffer.from('pdf'), {}, { apiKey: 'test-key', fetchImpl }),
    error => error.message === 'Rate limit reached.' && error.status === 429
  );
});

test('preserves OpenAI error details for actionable HTTP responses and logs', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: {
      message: 'Invalid PDF file.',
      code: 'invalid_file',
      type: 'invalid_request_error'
    } })
  });

  await assert.rejects(
    scanPdf(Buffer.from('pdf'), {}, { apiKey: 'test-key', fetchImpl }),
    error => error.message === 'Invalid PDF file.' &&
      error.status === 400 &&
      error.code === 'invalid_file' &&
      error.type === 'invalid_request_error'
  );
});
