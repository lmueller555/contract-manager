# LeaseLens

LeaseLens is a Heroku-ready Node application that accepts searchable GSA lease-solicitation PDFs, extracts their text in memory, identifies the statement of requirements, and presents key building and property criteria in a reviewable dashboard.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`, then upload a searchable PDF. Uploaded documents are processed in memory and are not written to disk.

## Deploy to Heroku

```bash
heroku create your-app-name
git push heroku main
heroku open
```

Heroku uses the included `Procfile` and the `web` process binds to the platform-provided `PORT` automatically.

## Tests

```bash
npm test
```

## Current extraction scope

The deterministic parser recognizes common GSA RLP language for solicitation metadata, requested ABOA area, parking, lease term, area boundaries, TI and BSAC allowances, and frequently used building/property criteria. It reports missing values rather than inventing them and exposes the extracted statement for human verification.

The PDF must include a readable text layer. Image-only scans require an OCR service before extraction and currently return a clear validation message.
