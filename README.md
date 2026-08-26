# LeaseLens

LeaseLens is a Heroku-ready Node application that sends GSA lease-solicitation PDFs to GPT-5.1 mini, gathers the document's requirements into a strict structured response, and presents key building and property criteria in a reviewable dashboard.

## Run locally

```bash
npm install
export OPENAI_API_KEY="your-api-key"
npm start
```

Open `http://localhost:3000`, then upload a PDF. Uploaded documents are processed in memory, sent directly to the OpenAI Responses API for analysis, and are not written to disk by LeaseLens.

## Deploy to Heroku

```bash
heroku create your-app-name
heroku config:set OPENAI_API_KEY="your-api-key"
git push heroku main
heroku open
```

Heroku uses the included `Procfile` and the `web` process binds to the platform-provided `PORT` automatically.

## Tests

```bash
npm test
```

## AI extraction

The scan route sends the complete PDF to the OpenAI Responses API using the `gpt-5.1-mini` model. A strict JSON schema captures solicitation metadata, requested ABOA area, parking, lease term, area boundaries, TI and BSAC allowances, building/property criteria, a requirements summary, and extraction confidence. The model is instructed to report missing values rather than invent them.

Because the model receives the PDF itself rather than locally extracted text, it can review both extracted text and page imagery. Always verify the generated dashboard against the source solicitation before making leasing decisions.
