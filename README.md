# LeaseLens

LeaseLens is a Heroku-ready Node application that sends GSA lease-solicitation PDFs to GPT-5 mini, gathers the document's requirements into a strict structured response, and presents key building and property criteria in a reviewable dashboard.

## Run locally

```bash
npm install
export OPENAI_API_KEY="your-api-key"
npm start
```

Open `http://localhost:3000`, then upload a PDF. Uploaded documents are processed in memory, sent directly to the OpenAI Responses API for analysis, and are not written to disk by LeaseLens.

Scans run as asynchronous jobs. The upload endpoint responds immediately and the browser polls for the result, so a long PDF analysis is not interrupted by a platform HTTP request timeout.

## Deploy to Heroku

```bash
heroku create your-app-name
heroku buildpacks:add --index 1 heroku-community/apt
heroku config:set OPENAI_API_KEY="your-api-key"
git push heroku main
heroku open
```

Heroku uses the included `Procfile` and the `web` process binds to the platform-provided `PORT` automatically. The Apt buildpack must run before the Node buildpack so it can install the Chromium shared-library dependencies listed in `Aptfile`. New apps created from `app.json` configure both buildpacks automatically; existing apps need the `heroku buildpacks:add` command above followed by a redeploy.

## Tests

```bash
npm test
```

## Property matching roadmap

See [the property matching scraper plan](docs/PROPERTY_MATCHING_SCRAPER.md) for
the source-adapter reconnaissance checklist, normalized data contracts,
evidence-backed scoring design, compliance gates, and staged delivery plan for
matching extracted requirements to commercial listings.

### Crexi matching

After a scan, LeaseLens saves a cleaned `document.searchLocation` (for example,
`Rosenberg, TX`) alongside the extracted document location. When matching is
requested, a Python process uses Playwright's synchronous API to launch a
headless Chromium browser, opens the Crexi home page, finds the accessible
location control at `#filter-location-input`, enters that search location, and
submits it. It then reads
structured result-card data, applies known price, cap-rate, area, status filters,
and only then requests detail pages for the surviving candidates. Detail JSON-LD
and semantic label/value fields are normalized into physical, lease, and
investment facts; unmodeled values are retained in `rawFields`.

`CREXI_SEARCH_URL_TEMPLATE` remains available as a test/integration override
for an approved location-specific search URL; use `{location}` where the
extracted market belongs. The adapter uses public HTML only, stops on
access-control and rate-limit responses, and does not call private `/api`
endpoints or attempt authentication/CAPTCHA bypasses.

`requirements.txt` pins Python Playwright to `>=1.54,<2`. The Heroku Python
buildpack installs it and `bin/post_compile` installs bundled Chromium; the Apt
buildpack supplies Chromium's native Linux libraries. Set
`CHROMIUM_EXECUTABLE_PATH` to use an approved system/configured Chromium instead.
The scraper captures rendered visible text, headings, links, native tables, and
ARIA grids and supports a bounded breadth-first same-origin crawl. Crexi uses a
single-page capture for each search/detail request. Matching deliberately
refuses to run an unbounded search when the document has no extracted location.

## AI extraction

The scan route accepts PDFs up to 100 MB and sends the complete document to the OpenAI Responses API using the `gpt-5-mini` model. A strict JSON schema captures solicitation metadata, requested ABOA area, parking, lease term, area boundaries, TI and BSAC allowances, building/property criteria, a requirements summary, and extraction confidence. The model is instructed to report missing values rather than invent them.

Because the model receives the PDF itself rather than locally extracted text, it can review both extracted text and page imagery. Always verify the generated dashboard against the source solicitation before making leasing decisions.
