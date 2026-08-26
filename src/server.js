'use strict';

const path = require('path');
const express = require('express');
const multer = require('multer');
const { scanPdf } = require('./openai-scanner');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => callback(null,
    file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf'))
});

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));

app.post('/api/documents/scan', upload.single('document'), async (request, response) => {
  if (!request.file) return response.status(400).json({ error: 'Choose a PDF document to scan.' });

  try {
    return response.json(await scanPdf(request.file.buffer, { fileName: request.file.originalname }));
  } catch (error) {
    console.error('PDF scan failed:', error.message);
    if (error.message === 'OPENAI_API_KEY is not configured.') {
      return response.status(503).json({ error: 'Document intelligence is not configured. Set OPENAI_API_KEY and try again.' });
    }
    if (error.name === 'AbortError') {
      return response.status(504).json({ error: 'The AI scan timed out. Please try again.' });
    }
    return response.status(502).json({ error: 'The AI could not scan that PDF. Confirm it is valid and try again.' });
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return response.status(413).json({ error: 'The PDF must be smaller than 20 MB.' });
  }
  console.error(error);
  return response.status(500).json({ error: 'Something went wrong while processing the document.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`LeaseLens listening on port ${port}`));
