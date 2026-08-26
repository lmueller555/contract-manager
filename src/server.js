'use strict';

const path = require('path');
const express = require('express');
const multer = require('multer');
const { scanPdf } = require('./openai-scanner');
const { CrexiSource } = require('./crexi-source');
const { evaluateProperty, profileFromScan } = require('./property-matcher');

const app = express();
const MAX_DOCUMENT_SIZE_MB = 100;
const SCAN_RESULT_TTL_MS = 30 * 60 * 1000;
const scans = new Map();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_SIZE_MB * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => callback(null,
    file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf'))
});

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));

function publicScan(scan) {
  if (scan.status === 'complete') return { status: scan.status, result: scan.result };
  if (scan.status === 'failed') return { status: scan.status, error: scan.error };
  return { status: scan.status };
}

function scanError(error) {
  if (error.message === 'OPENAI_API_KEY is not configured.') {
    return { httpStatus: 503, message: 'Document intelligence is not configured. Set OPENAI_API_KEY and try again.' };
  }
  if (error.name === 'AbortError') {
    return { httpStatus: 504, message: 'The AI scan timed out. Please try again.' };
  }
  if (error.status === 401 || error.status === 403) {
    return { httpStatus: 503, message: 'Document intelligence could not authenticate. Check OPENAI_API_KEY and try again.' };
  }
  if (error.status === 413) {
    return { httpStatus: 413, message: 'The PDF was accepted by LeaseLens, but is too large for the AI service to scan. Try an optimized PDF.' };
  }
  if (error.status === 429) {
    return { httpStatus: 503, message: 'The AI service is busy or has reached its usage limit. Please try again shortly.' };
  }
  if (error.status === 400 && /model/i.test(error.message)) {
    return { httpStatus: 503, message: 'Document intelligence is temporarily misconfigured. Please contact the administrator.' };
  }
  if (error.status === 400) {
    return { httpStatus: 422, message: 'The AI service rejected this PDF. Confirm it is valid, not password protected, and try again.' };
  }
  return { httpStatus: 502, message: 'The AI could not scan that PDF. Confirm it is valid and try again.' };
}

app.post('/api/documents/scan', upload.single('document'), (request, response) => {
  if (!request.file) return response.status(400).json({ error: 'Choose a PDF document to scan.' });

  const id = require('crypto').randomUUID();
  const scan = { status: 'processing' };
  scans.set(id, scan);

  scanPdf(request.file.buffer, { fileName: request.file.originalname }).then(result => {
    scan.status = 'complete';
    scan.result = result;
  }).catch(error => {
    console.error('PDF scan failed:', {
      message: error.message,
      status: error.status,
      code: error.code,
      type: error.type
    });
    scan.status = 'failed';
    scan.error = scanError(error).message;
  });

  setTimeout(() => scans.delete(id), SCAN_RESULT_TTL_MS).unref();
  return response.status(202).json({ id, status: scan.status });
});

app.get('/api/documents/scan/:id', (request, response) => {
  const scan = scans.get(request.params.id);
  if (!scan) return response.status(404).json({ error: 'This scan was not found or has expired.' });
  return response.json(publicScan(scan));
});

app.post('/api/documents/scan/:id/crexi-matches', express.json(), async (request, response) => {
  const scan = scans.get(request.params.id);
  if (!scan || scan.status !== 'complete') return response.status(404).json({ error: 'A completed scan is required before matching properties.' });
  try {
    const profile = profileFromScan(scan.result);
    const properties = await new CrexiSource().find(profile);
    const matches = properties.map(property => evaluateProperty(profile, property))
      .sort((a, b) => b.score - a.score || b.coverage - a.coverage).slice(0, 10);
    return response.json({ source: 'crexi', observedAt: new Date().toISOString(), profile, matches });
  } catch (error) {
    console.error('Crexi matching failed:', { message: error.message });
    return response.status(502).json({ error: error.message });
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return response.status(413).json({ error: `The PDF must be smaller than ${MAX_DOCUMENT_SIZE_MB} MB.` });
  }
  console.error(error);
  return response.status(500).json({ error: 'Something went wrong while processing the document.' });
});

const port = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(port, () => console.log(`LeaseLens listening on port ${port}`));
}

module.exports = { app, scanError };
