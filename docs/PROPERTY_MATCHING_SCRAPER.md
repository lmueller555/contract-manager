# Property matching scraper: reconnaissance and implementation plan

## Executive recommendation

Build this as a **source-adapter pipeline**, not as an LLM that drives a browser.
Use an approved API, data feed, export, or partner integration whenever a source
offers one. When automated retrieval is permitted, deterministic browser code
should collect search results and listing facts; an LLM should only normalize
ambiguous text and explain matches. This split makes runs reproducible, limits
token cost, and prevents the model from inventing listing facts.

The current application already converts a client's lease PDF into structured
requirements. The next feature should persist that result as a `SearchProfile`,
query each source adapter, normalize every result into one common `Property`
shape, evaluate hard constraints, score the remaining candidates, and return a
ranked top ten with evidence for every claimed match.

## Reconnaissance status (August 26, 2026)

The three requested public entry points are:

| Source | Entry point | Intended human workflow | Verification status |
| --- | --- | --- | --- |
| LoopNet | <https://www.loopnet.com/> | Choose sale/lease, property type, and geography; refine on a results/map page; open a listing detail page. | The execution environment's outbound proxy rejected the site with HTTP 403 before the origin page loaded. DOM selectors, current filters, pagination behavior, and terms were therefore **not verified**. |
| Crexi | <https://www.crexi.com/> | Choose properties for sale/lease, enter a market, refine the result set, and open a property page. | The execution environment's outbound proxy rejected the site with HTTP 403 before the origin page loaded. DOM selectors, current filters, pagination behavior, and terms were therefore **not verified**. |
| HAR Commercial Gateway | <https://www.har.com/commgate> | Enter the commercial gateway, choose a listing category and area, refine results, and open a listing. | The execution environment's outbound proxy rejected the site with HTTP 403 before the origin page loaded. DOM selectors, current filters, pagination behavior, and terms were therefore **not verified**. |

This is deliberately not presented as a completed selector map. A proxy-level
403 is different from a site's own bot response and supplies no reliable DOM
information. Do not implement selectors from guesses or old screenshots.

### Required live-site discovery session

Before implementing any adapter, an authorized operator should use a normal
browser from the deployment region and save the following artifacts for **each**
site. Confirm the site's current terms of use, robots directives, licensing
restrictions, and availability of an API/feed with counsel or the data owner.

1. A HAR file for one search, one filter change, one pagination/infinite-scroll
   action, and one listing-detail visit. Redact cookies, tokens, email addresses,
   and other personal data before committing or sharing it.
2. The rendered HTML and screenshot for the empty state, results page, result
   card, map/list switch (if present), and listing detail page.
3. The exact user-visible filter names and units: transaction type, property
   type/subtype, price/rent basis, building and available area, lot area, year
   built, geography/radius, and listing status.
4. Whether results are server-rendered, embedded as JSON in the document, or
   returned by XHR/fetch/GraphQL. Prefer a documented feed. Do not reverse
   engineer private endpoints or circumvent access controls.
5. Pagination style and stable listing identifier; canonical URL behavior;
   result count; sort options; update timestamp; broker/contact visibility; and
   whether brochures require authentication.
6. Rate-limit signals (`429`, `Retry-After`), login boundaries, CAPTCHA or bot
   challenges, and the site's published support/contact route for data access.

Capture discoveries in the adapter map below. Values marked `TBD` must block a
production adapter rather than silently falling back to a guessed selector.

| Concern | LoopNet | Crexi | HAR CommGate |
| --- | --- | --- | --- |
| Permitted access method | TBD with source | TBD with source | TBD with source |
| Search URL/request | TBD | TBD | TBD |
| Geography encoding | TBD | TBD | TBD |
| Filter encoding | TBD | TBD | TBD |
| Results container/card | TBD | TBD | TBD |
| Stable listing ID | TBD | TBD | TBD |
| Embedded structured data | Inspect JSON-LD/initial state | Inspect JSON-LD/initial state | Inspect JSON-LD/initial state |
| Pagination/continuation | TBD | TBD | TBD |
| Detail fields | TBD | TBD | TBD |
| Authentication required | TBD | TBD | TBD |
| Rate policy | TBD | TBD | TBD |
| Terms/robots review date | TBD | TBD | TBD |

## Data contracts

Store facts and evidence separately from conclusions. Suggested TypeScript-like
contracts (they can initially be implemented in plain JavaScript) are:

```ts
type SearchProfile = {
  profileId: string;
  sourceDocumentId: string;
  transaction: "lease" | "sale" | "either";
  geography: {
    boundaryText: { north?: string; south?: string; east?: string; west?: string };
    polygon?: Array<[number, number]>; // [longitude, latitude]
    required: boolean;
  };
  uses: string[];
  area: { minSqFt?: number; maxSqFt?: number; basis?: "ABOA" | "rentable" | "building" };
  parking: { minimumSpaces?: number; minimumRatioPerKsf?: number };
  leaseTermMonths?: { min?: number; max?: number };
  criteria: Requirement[];
};

type Requirement = {
  id: string;
  text: string;
  kind: string;
  priority: "required" | "preferred";
  weight: number;
  operator?: "eq" | "gte" | "lte" | "contains" | "within";
  target?: string | number | boolean;
  unit?: string;
};

type Property = {
  canonicalId: string;              // source + source listing ID
  source: "loopnet" | "crexi" | "har_commgate";
  sourceListingId: string;
  url: string;
  capturedAt: string;
  status?: string;
  title?: string;
  address?: string;
  coordinates?: { lat: number; lon: number };
  transaction?: "lease" | "sale";
  propertyTypes: string[];
  availableSqFt?: { min?: number; max?: number; basis?: string };
  buildingSqFt?: number;
  lotSqFt?: number;
  askingPrice?: number;
  askingRent?: { amount: number; unit: string };
  parkingSpaces?: number;
  parkingRatioPerKsf?: number;
  yearBuilt?: number;
  description?: string;
  amenities: string[];
  evidence: Evidence[];
};

type Evidence = {
  field: string;
  value: unknown;
  sourceUrl: string;
  capturedAt: string;
  locator: string; // JSON path, semantic label, or short DOM locator
  excerpt?: string;
};

type RequirementEvaluation = {
  requirementId: string;
  outcome: "matched" | "not_matched" | "unknown";
  confidence: number;
  explanation: string;
  evidenceIndexes: number[];
};
```

Do not treat an absent listing field as a failure. `unknown` is essential: “no
parking value published” is not evidence that a property has no parking.

## Adapter contract and acquisition flow

Every site-specific module should implement the same narrow interface:

```js
class ListingSource {
  async search(profile, cursor) {
    // => { summaries, nextCursor, observedAt }
  }

  async details(summary) {
    // => raw source record plus capture metadata
  }

  normalize(rawRecord) {
    // => Property; no ranking and no unsupported inference
  }
}
```

Recommended pipeline:

1. Convert the uploaded PDF result into a reviewable `SearchProfile`. Ask the
   user to label requirements as required/preferred and resolve ABOA versus
   rentable/building-area ambiguity before searching.
2. Translate only source-supported fields into broad search filters. Search a
   little wider than the client's bounds so the scorer can find close matches.
3. Retrieve summaries, follow pagination within a configured page/property
   budget, deduplicate by source listing ID, then fetch allowed detail pages.
4. Save the raw response hash, capture time, canonical URL, normalized record,
   and field-level evidence. Encrypt storage and set a short retention policy.
5. Merge cross-posted properties using normalized address plus coordinates, but
   retain each source record and URL. Never merge solely by title.
6. Run deterministic checks first. Send only the description, amenities, and
   still-unresolved qualitative requirements to the LLM using a strict schema.
7. Rank, return ten results, and display matched/not-matched/unknown counts with
   evidence. A user must be able to open the source listing and review the facts.

For browser-backed adapters, use accessible labels and structured data before
CSS class names, which are often generated and unstable. Keep concurrency low,
honor explicit retry delays, use exponential backoff with jitter for transient
errors, stop on access challenges, and cache pages. Do not rotate identities,
solve CAPTCHAs, conceal automation, or bypass authentication/paywalls.

## Matching and ranking

### Deterministic evaluation

Evaluate numeric, categorical, and geographic constraints without an LLM:

- Geocode client boundaries and listing addresses through a licensed provider,
  retain geocoding confidence, and use point-in-polygon for the delineated area.
- Normalize all areas to square feet while retaining the published basis. ABOA
  and rentable area are not interchangeable unless an explicit conversion is
  supplied.
- Normalize rent units (for example, per square foot per year versus per month)
  without guessing whether expenses are gross, modified gross, or NNN.
- Check minimum/maximum area as an interval overlap. Flag partial-divisibility
  claims as unknown unless the listing explicitly supports subdivision.
- Compute a parking ratio only when both parking count and the applicable area
  are known.

### LLM evaluation

Use the LLM only for qualitative statements such as loading access, contiguous
floors, security characteristics, proximity descriptions, and special-use
language. Give it one property at a time, the enumerated requirements, and the
listing evidence. Require strict JSON containing one evaluation per requirement.
The prompt must say:

- use only supplied evidence;
- return `unknown` when evidence is absent or ambiguous;
- never convert marketing language into a verified fact;
- cite evidence indexes, not invented quotations; and
- keep confidence below a configured threshold for inferred/indirect matches.

Validate the response against a JSON schema, reject unknown requirement IDs or
evidence indexes, and retry schema failures at most once. Cache by a hash of the
profile, normalized property, prompt version, and model.

### Score

Hard failures should normally be shown in a separate “near matches” group rather
than hidden. For candidates without a hard failure, use:

```text
known_weight = sum(weight for matched or not_matched requirements)
earned_weight = sum(weight * confidence for matched requirements)
match_score = 100 * earned_weight / known_weight
coverage = known_weight / sum(weight for all requirements)
final_score = match_score * (0.7 + 0.3 * coverage)
```

Rank by `final_score`, then coverage, then data freshness. Display all of:

- `matched / total` (the requested headline count),
- `not matched`,
- `unknown`,
- weighted score and evidence coverage, and
- any required constraint that failed.

This prevents a property with two easy known matches and twenty missing fields
from outranking a well-documented property. It also avoids claiming that an LLM
probability is an objective property score.

## Operations, safety, and quality

- **Compliance gate:** no adapter becomes enabled until its permitted access
  method, attribution requirements, retention rules, and rate limits are recorded.
- **Secrets:** keep API keys and authenticated browser state in a secret manager;
  never place session cookies or HAR files in Git.
- **Scheduling:** use a queue with per-source concurrency and daily request
  budgets. A worker should checkpoint cursors and support cancellation.
- **Freshness:** mark stale/removed listings, keep last-seen time, and re-check the
  final ten before presenting them.
- **Observability:** record request status/latency, pages and listings processed,
  schema failures, unknown-field rates, deduplication decisions, token cost, and
  adapter version—without logging personal data or credentials.
- **Change detection:** run fixture-based adapter tests on every change and a
  permitted low-frequency live canary. Disable the adapter when required fields
  disappear rather than returning misleading empty results.
- **Human review:** label results as leads, not verified availability. Listing
  facts, measurements, availability, and pricing require broker/owner confirmation.

## Testing plan

1. Unit-test parsing and unit normalization with checked-in, redacted fixtures.
2. Contract-test every adapter against the common `Property` schema.
3. Test missing fields, malformed values, duplicate listings, expired listings,
   pagination loops, `429`, `403`, timeout, and changed markup.
4. Build a labeled evaluation set of profiles/properties reviewed by a commercial
   real-estate analyst. Track precision/recall for each requirement type and
   ranking quality (for example NDCG@10), not just JSON validity.
5. Test prompt-injection text inside listings. Listing content is untrusted data
   and must never be allowed to alter system instructions or invoke tools.
6. Replay a frozen crawl to make ranking tests deterministic and verify that
   every `matched` result has valid evidence.

## Delivery sequence

### Phase 0 — authorization and discovery

Obtain source approval/API credentials where needed, complete the live discovery
matrix, select geocoding/storage vendors, and define crawl and retention budgets.

### Phase 1 — matching core

Add `SearchProfile`, `Property`, evidence, deterministic evaluators, scoring, and
fixture tests. Add a review step after PDF extraction so users can correct units,
priorities, and boundaries.

### Phase 2 — one approved source

Implement the source with the most stable approved feed first. Run it in shadow
mode, compare results with a manual search, and establish quality/cost baselines.

### Phase 3 — remaining sources and UI

Add adapters one at a time. Build the top-ten table with score, match counts,
unknown count, failed hard requirements, evidence drawer, capture time, and link
to the source. Include CSV/JSON export with provenance.

### Phase 4 — production hardening

Add scheduled refresh, stale-result handling, queue controls, canary monitoring,
audit logs, deletion controls, and an adapter kill switch.

## Decisions needed before coding the adapters

1. Has each source granted automated-use rights, or can it provide a commercial
   API/feed/export?
2. Is the target transaction lease, sale, or both, and which property types apply?
3. Which requirements are absolute disqualifiers versus preferences?
4. What geography should be used when the PDF provides only street boundaries?
5. How many results/pages may each run inspect, how fresh must results be, and
   what monthly data/API/LLM budget is acceptable?
6. Should broker contact details be excluded from collection to reduce personal
   data handling?

