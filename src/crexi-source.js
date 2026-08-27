'use strict';

const BASE_URL = 'https://www.crexi.com';
const LOCATION_SELECTOR = '#filter-location-input';
const { scrapeWithPlaywright } = require('./playwright-scraper');

function decode(value = '') {
  return String(value).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

function jsonScripts(html) {
  const values = [];
  const pattern = /<script[^>]+type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try { values.push(JSON.parse(decode(match[1].trim()))); } catch { /* Optional metadata may be malformed. */ }
  }
  return values;
}

function flattenJson(value, output = []) {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) value.forEach(item => flattenJson(item, output));
  else {
    output.push(value);
    if (Array.isArray(value['@graph'])) value['@graph'].forEach(item => flattenJson(item, output));
    for (const [key, child] of Object.entries(value)) if (key !== '@graph' && child && typeof child === 'object') flattenJson(child, output);
  }
  return output;
}

function jsonLd(html) { return jsonScripts(html).flatMap(value => flattenJson(value)); }

function listingId(value) { return String(value || '').match(/\/properties\/(\d+)(?:\/|$)/)?.[1]; }

function listingLinks(html) {
  const links = new Map();
  for (const match of html.matchAll(/href=["']([^"']*\/properties\/\d+(?:\/[^"'#?]*)?)[^"']*["']/gi)) {
    const url = new URL(decode(match[1]), BASE_URL); url.search = ''; url.hash = '';
    links.set(listingId(url.pathname), url.href.replace(/\/$/, ''));
  }
  return [...links.values()];
}

function numberFrom(value, percent = false) {
  if (typeof value === 'number') return Number.isFinite(value) ? (percent && value > 1 ? value / 100 : value) : undefined;
  const match = String(value ?? '').replace(/[$,%]/g, '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const result = Number(match[0]);
  return percent && result > 1 ? result / 100 : result;
}

function rangeFrom(value) {
  const numbers = String(value ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
  return numbers.length ? { min: Math.min(...numbers), max: Math.max(...numbers), basis: 'published' } : undefined;
}

function first(record, names) {
  for (const name of names) if (record?.[name] !== undefined && record[name] !== null && record[name] !== '') return record[name];
}

function addressFrom(value) {
  if (typeof value === 'string') return value;
  return [value?.streetAddress, value?.addressLocality, value?.addressRegion, value?.postalCode].filter(Boolean).join(', ') || undefined;
}

function recordUrl(record) {
  const value = first(record, ['url', 'canonicalUrl', 'listingUrl', 'propertyUrl']);
  if (typeof value !== 'string' || !listingId(value)) return undefined;
  return new URL(value, BASE_URL).href;
}

function summaryFromRecord(record) {
  const url = recordUrl(record); if (!url) return undefined;
  const offers = Array.isArray(record.offers) ? record.offers[0] : record.offers || {};
  const area = first(record, ['availableSqFt', 'availableSF', 'availableSize', 'buildingSqFt', 'squareFootage', 'floorSize']);
  const types = first(record, ['propertyTypes', 'propertyType', 'types', 'subType']);
  return {
    sourceListingId: listingId(url), url, name: first(record, ['name', 'propertyName', 'title', 'headline']),
    address: addressFrom(record.address || record.location) || first(record, ['formattedAddress']),
    propertyTypes: (Array.isArray(types) ? types : types ? [types] : []).map(String),
    askingPrice: numberFrom(first(record, ['askingPrice', 'price']) ?? offers.price),
    leaseRate: first(record, ['leaseRate', 'rent', 'askingRent']), capRate: numberFrom(first(record, ['capRate', 'capitalizationRate']), true),
    availableSqFt: rangeFrom(area?.value ?? area), unitCount: numberFrom(first(record, ['unitCount', 'units'])),
    headline: first(record, ['headline', 'description']), status: first(record, ['status', 'listingStatus', 'itemCondition']), raw: record
  };
}

function cardSummaries(html) {
  const summaries = new Map();
  for (const record of jsonScripts(html).flatMap(value => flattenJson(value))) {
    const summary = summaryFromRecord(record);
    if (summary) summaries.set(summary.sourceListingId, { ...(summaries.get(summary.sourceListingId) || {}), ...summary });
  }
  for (const url of listingLinks(html)) {
    const id = listingId(url); if (!summaries.has(id)) summaries.set(id, { sourceListingId: id, url });
  }
  return [...summaries.values()];
}

function buildSearchUrl(profile = {}, template) {
  const transaction = profile.transaction === 'sale' ? 'sale' : 'lease';
  const base = template
    ? template.replaceAll('{location}', encodeURIComponent(profile.location || ''))
    : `${BASE_URL}/${transaction === 'lease' ? 'lease/' : ''}properties`;
  const url = new URL(base);
  const capRateMin = profile.capRateMin ?? profile.investment?.capRateMin;
  if (capRateMin != null && transaction === 'sale') url.searchParams.set('capRateMin', String(capRateMin <= 1 ? capRateMin * 100 : capRateMin));
  const types = profile.propertyTypes?.length ? profile.propertyTypes : profile.uses;
  for (const type of types || []) if (type) url.searchParams.append('types[]', type);
  if (profile.sort) url.searchParams.set('sort', profile.sort);
  if (profile.page) url.searchParams.set('page', String(profile.page));
  return url.href;
}

function passesHardFilters(summary, profile) {
  if (profile.askingPriceMax != null && summary.askingPrice != null && summary.askingPrice > profile.askingPriceMax) return false;
  const capRateMin = profile.capRateMin ?? profile.investment?.capRateMin;
  if (capRateMin != null && summary.capRate != null && summary.capRate < (capRateMin > 1 ? capRateMin / 100 : capRateMin)) return false;
  const requestedMin = profile.area?.minSqFt;
  const requestedMax = profile.area?.maxSqFt ?? requestedMin;
  if (requestedMin && summary.availableSqFt && (summary.availableSqFt.max < requestedMin || summary.availableSqFt.min > requestedMax)) return false;
  return !/sold|off market|closed/i.test(summary.status || '');
}

function labeledFields(html) {
  const fields = {};
  const text = decode(html).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/+(?:div|li|p|dt|dd|tr|td|th|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();
  const labels = ['Asking Price', 'Days on Market', 'Last Updated', 'Property Type', 'Property Subtype', 'Square Footage', 'Lot Size', 'Cap Rate', 'NOI', 'Occupancy', 'Tenancy', 'Tenant', 'Tenant Credit', 'Lease Type', 'Lease Term', 'Lease Commencement', 'Lease Expiration', 'Remaining Lease Term', 'Rent Bumps', 'Lease Options', 'Building Class', 'Year Built', 'Year Renovated', 'Number of Buildings', 'Investment Type', 'Ownership Structure', 'Ground Lease', 'Broker Co-Op'];
  const boundary = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  for (const label of labels) {
    const match = text.match(new RegExp(`${label}\\s*[:\\n]\\s*([^\\n]{1,160}?)(?=\\s*(?:${boundary})\\s*[:\\n]|$)`, 'i'));
    if (match) fields[label] = match[1].trim();
  }
  return fields;
}

class CrexiSource {
  constructor(options = {}) {
    this.fetch = options.fetchImpl || globalThis.fetch; this.searchUrlTemplate = options.searchUrlTemplate || process.env.CREXI_SEARCH_URL_TEMPLATE;
    this.maxListings = options.maxListings || 25; this.delayMs = options.delayMs ?? 250;
    this.scrape = options.scrapeImpl || scrapeWithPlaywright;
  }

  async get(url) {
    const response = await this.fetch(url, { headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'LeaseLens/1.0 property-research' }, redirect: 'follow' });
    if ([401, 403, 429].includes(response.status)) throw new Error(`Crexi access stopped (HTTP ${response.status}); do not bypass the access control. Confirm the approved access method.`);
    if (!response.ok) throw new Error(`Crexi returned HTTP ${response.status}.`);
    return { html: await response.text(), capturedAt: new Date().toISOString(), url: response.url || url };
  }

  async search(profile) {
    if (!profile.location) throw new Error('The scanned document does not contain a location to search on Crexi.');
    const page = this.searchUrlTemplate
      ? await this.get(buildSearchUrl(profile, this.searchUrlTemplate))
      : await this.searchWithBrowser(profile.location);
    const summaries = cardSummaries(page.html).map(item => ({ ...item, transaction: profile.transaction || 'lease' }))
      .filter(item => passesHardFilters(item, profile)).slice(0, this.maxListings);
    return { summaries, nextCursor: null, observedAt: page.capturedAt };
  }

  async searchWithBrowser(location) {
    const result = await this.scrape({ url: BASE_URL, location, locationSelector: LOCATION_SELECTOR, maxPages: 1 });
    if (!result.pages?.[0]) throw new Error('The Python Playwright scraper did not capture the Crexi results page.');
    return result.pages[0];
  }

  async details(summary) {
    if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
    const result = await this.scrape({ url: summary.url, maxPages: 1 });
    const page = result.pages?.[0];
    if (!page) throw new Error(`The Python Playwright scraper did not capture ${summary.url}.`);
    const records = jsonLd(page.html);
    const record = records.find(item => ['RealEstateListing', 'Place', 'Product', 'Offer'].includes(item['@type'])) || records.find(item => item.address || item.offers) || {};
    return { record, summary, rawFields: labeledFields(page.html), ...page };
  }

  normalize(raw) {
    const record = raw.record || {}, fields = raw.rawFields || {}, summary = raw.summary || {};
    const sourceListingId = listingId(raw.url) || new URL(raw.url).pathname;
    const addressObject = typeof record.address === 'object' ? record.address : {};
    const area = rangeFrom(first(record, ['availableSqFt', 'floorSize', 'squareFootage'])?.value ?? first(record, ['availableSqFt', 'floorSize', 'squareFootage']) ?? fields['Square Footage']) || summary.availableSqFt;
    const value = (...names) => first(record, names) ?? names.map(name => fields[name]).find(item => item != null);
    const property = {
      canonicalId: `crexi:${sourceListingId}`, source: 'crexi', sourceListingId, url: raw.url, capturedAt: raw.capturedAt,
      title: first(record, ['name', 'headline']) || summary.name, address: addressFrom(record.address) || summary.address,
      city: addressObject.addressLocality, state: addressObject.addressRegion, zip: addressObject.postalCode,
      status: value('status', 'listingStatus', 'itemCondition'), transaction: value('transactionType') || summary.transaction || (/\/lease\//.test(raw.url) ? 'lease' : 'sale'),
      propertyTypes: (summary.propertyTypes?.length ? summary.propertyTypes : [value('propertyType', 'Property Type')].filter(Boolean)),
      propertySubtype: value('propertySubtype', 'Property Subtype'), askingPrice: numberFrom(value('askingPrice', 'price', 'Asking Price')) || summary.askingPrice,
      askingRent: value('leaseRate', 'Lease Rate') || summary.leaseRate, availableSqFt: area, buildingSqFt: area?.max,
      lotAcres: numberFrom(value('acreage', 'Lot Size')), capRate: numberFrom(value('capRate', 'Cap Rate'), true) || summary.capRate,
      noi: numberFrom(value('noi', 'NOI')), occupancyPct: numberFrom(value('occupancy', 'Occupancy'), true), tenancy: value('tenancy', 'Tenancy'),
      tenantName: value('tenant', 'Tenant'), tenantCredit: value('tenantCredit', 'Tenant Credit'), leaseType: value('leaseType', 'Lease Type'),
      leaseCommencement: value('leaseCommencement', 'Lease Commencement'), leaseExpiration: value('leaseExpiration', 'Lease Expiration'),
      remainingTermYears: numberFrom(value('remainingLeaseTerm', 'Remaining Lease Term')), rentBumps: value('rentBumps', 'Rent Bumps'), leaseOptions: value('leaseOptions', 'Lease Options'),
      buildingClass: value('buildingClass', 'Building Class'), yearBuilt: numberFrom(value('yearBuilt', 'Year Built')), yearRenovated: numberFrom(value('yearRenovated', 'Year Renovated')),
      numberOfBuildings: numberFrom(value('numberOfBuildings', 'Number of Buildings')), investmentType: value('investmentType', 'Investment Type'), ownershipStructure: value('ownershipStructure', 'Ownership Structure'),
      description: value('description'), investmentHighlights: first(record, ['investmentHighlights', 'highlights']), amenities: first(record, ['amenities']) || [],
      daysOnMarket: numberFrom(value('daysOnMarket', 'Days on Market')), lastUpdated: value('dateModified', 'lastUpdated', 'Last Updated'), rawFields: fields, evidence: []
    };
    for (const field of ['title', 'address', 'availableSqFt', 'askingPrice', 'capRate', 'noi', 'occupancyPct', 'description']) if (property[field] != null) property.evidence.push({ field, value: property[field], sourceUrl: raw.url, capturedAt: raw.capturedAt, locator: fields[field] ? `label:${field}` : `structured-data.${field}` });
    return property;
  }

  async find(profile) {
    const { summaries } = await this.search(profile); const properties = [];
    for (const summary of summaries) properties.push(this.normalize(await this.details(summary)));
    return properties;
  }
}

module.exports = { CrexiSource, LOCATION_SELECTOR, buildSearchUrl, cardSummaries, jsonLd, labeledFields, listingLinks, passesHardFilters };
