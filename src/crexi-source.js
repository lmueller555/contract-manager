'use strict';

const BASE_URL = 'https://www.crexi.com';

function decode(value) {
  return value.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function jsonLd(html) {
  const values = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const parsed = JSON.parse(decode(match[1].trim()));
      values.push(...(Array.isArray(parsed) ? parsed : parsed['@graph'] || [parsed]));
    } catch { /* A malformed optional metadata block is not listing evidence. */ }
  }
  return values;
}

function listingLinks(html) {
  const links = new Set();
  for (const match of html.matchAll(/href=["']([^"']*\/properties\/\d+\/[^"'#?]+)[^"']*["']/gi)) {
    links.add(new URL(decode(match[1]), BASE_URL).href);
  }
  return [...links];
}

function areaFrom(record) {
  const value = record.floorSize?.value ?? record.floorSize ?? record.additionalProperty?.find(p => /(?:available|building).*size/i.test(p.name || ''))?.value;
  const numbers = String(value || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
  return numbers.length ? { min: Math.min(...numbers), max: Math.max(...numbers), basis: 'published' } : undefined;
}

class CrexiSource {
  constructor(options = {}) {
    this.fetch = options.fetchImpl || globalThis.fetch;
    this.searchUrlTemplate = options.searchUrlTemplate || process.env.CREXI_SEARCH_URL_TEMPLATE;
    this.maxListings = options.maxListings || 25;
    this.delayMs = options.delayMs ?? 250;
  }

  async get(url) {
    const response = await this.fetch(url, { headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'LeaseLens/1.0 property-research' }, redirect: 'follow' });
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      throw new Error(`Crexi access stopped (HTTP ${response.status}); do not bypass the access control. Confirm the approved access method.`);
    }
    if (!response.ok) throw new Error(`Crexi returned HTTP ${response.status}.`);
    return { html: await response.text(), capturedAt: new Date().toISOString(), url: response.url || url };
  }

  async search(profile) {
    if (!this.searchUrlTemplate) throw new Error('Crexi matching is not configured. Set CREXI_SEARCH_URL_TEMPLATE to an approved Crexi search URL containing {location}.');
    const url = this.searchUrlTemplate.replaceAll('{location}', encodeURIComponent(profile.location || ''));
    const page = await this.get(url);
    return { summaries: listingLinks(page.html).slice(0, this.maxListings).map(url => ({ url })), nextCursor: null, observedAt: page.capturedAt };
  }

  async details(summary) {
    if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
    const page = await this.get(summary.url);
    const records = jsonLd(page.html);
    const record = records.find(item => ['RealEstateListing', 'Place', 'Product', 'Offer'].includes(item['@type'])) || records.find(item => item.address || item.offers);
    if (!record) return { record: {}, ...page };
    return { record, ...page };
  }

  normalize(raw) {
    const record = raw.record || {};
    const sourceListingId = raw.url.match(/\/properties\/(\d+)/)?.[1] || new URL(raw.url).pathname;
    const address = typeof record.address === 'string' ? record.address : [record.address?.streetAddress, record.address?.addressLocality, record.address?.addressRegion].filter(Boolean).join(', ');
    const availableSqFt = areaFrom(record);
    const property = {
      canonicalId: `crexi:${sourceListingId}`, source: 'crexi', sourceListingId, url: raw.url,
      capturedAt: raw.capturedAt, title: record.name || record.headline, address: address || undefined,
      status: record.itemCondition, transaction: 'lease', propertyTypes: [], availableSqFt,
      description: record.description, amenities: [], evidence: []
    };
    for (const [field, value] of [['title', property.title], ['address', property.address], ['availableSqFt', availableSqFt], ['description', property.description]]) {
      if (value != null) property.evidence.push({ field, value, sourceUrl: raw.url, capturedAt: raw.capturedAt, locator: `JSON-LD.${field}` });
    }
    return property;
  }

  async find(profile) {
    const { summaries } = await this.search(profile);
    const properties = [];
    for (const summary of summaries) properties.push(this.normalize(await this.details(summary)));
    return properties;
  }
}

module.exports = { CrexiSource, jsonLd, listingLinks };
