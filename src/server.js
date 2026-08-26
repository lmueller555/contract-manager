'use strict';

const path = require('path');
const express = require('express');
const multer = require('multer');
const pdf = require('pdf-parse');
const { parseRequirements } = require('./parser');

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
    const extracted = await pdf(request.file.buffer);
    if (!extracted.text || extracted.text.trim().length < 50) {
      return response.status(422).json({ error: 'This PDF has no readable text layer. Please upload a searchable PDF.' });
    }
    return response.json(parseRequirements(extracted.text, {
      fileName: request.file.originalname,
      pages: extracted.numpages
    }));
  } catch (error) {
    console.error('PDF scan failed:', error.message);
    return response.status(422).json({ error: 'We could not read that PDF. Confirm that it is valid and not password protected.' });
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
