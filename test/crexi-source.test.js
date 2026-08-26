'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CrexiSource, jsonLd, listingLinks } = require('../src/crexi-source');
const { evaluateProperty, profileFromScan } = require('../src/property-matcher');

test('discovers Crexi listing links and normalizes JSON-LD with evidence', async () => {
  const searchHtml = '<a href="/properties/123/example-building">Example</a><a href="/properties/123/example-building?x=1">duplicate</a>';
  const detailHtml = `<script type="application/ld+json">${JSON.stringify({ '@type': 'RealEstateListing', name: 'Example Building', address: { streetAddress: '1 Main St', addressLocality: 'Houston', addressRegion: 'TX' }, floorSize: { value: '35,000 - 45,000 SF' }, description: 'Office space' })}</script>`;
  const fetchImpl = async url => ({ ok: true, status: 200, url, text: async () => url.includes('/properties/123/') ? detailHtml : searchHtml });
  const source = new CrexiSource({ fetchImpl, searchUrlTemplate: 'https://www.crexi.com/properties?place={location}', delayMs: 0 });
  const properties = await source.find({ location: 'Houston, TX' });
  assert.equal(properties.length, 1);
  assert.equal(properties[0].canonicalId, 'crexi:123');
  assert.deepEqual(properties[0].availableSqFt, { min: 35000, max: 45000, basis: 'published' });
  assert.ok(properties[0].evidence.some(item => item.field === 'availableSqFt'));
  assert.equal(listingLinks(searchHtml).length, 1);
  assert.equal(jsonLd(detailHtml)[0].name, 'Example Building');
});

test('stops rather than attempting to bypass a Crexi access response', async () => {
  const source = new CrexiSource({ searchUrlTemplate: 'https://www.crexi.com/?q={location}', fetchImpl: async () => ({ ok: false, status: 403 }), delayMs: 0 });
  await assert.rejects(source.search({ location: 'Houston' }), /do not bypass/);
});

test('builds a profile and ranks known facts while preserving unknowns', () => {
  const profile = profileFromScan({ document: { location: 'Houston' }, space: { aboaSquareFeet: '38,685', parkingSpaces: '3' }, boundaries: {}, requirements: ['Loading dock'] });
  const result = evaluateProperty(profile, { availableSqFt: { min: 35000, max: 45000 }, evidence: [{ field: 'availableSqFt' }] });
  assert.equal(result.matched, 1);
  assert.equal(result.notMatched, 0);
  assert.equal(result.unknown, 2);
  assert.ok(result.score > 0);
});
