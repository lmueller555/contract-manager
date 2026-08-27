'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CrexiSource, buildSearchUrl, cardSummaries, jsonLd, labeledFields, listingLinks, passesHardFilters } = require('../src/crexi-source');
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

test('translates supported requirements into Crexi public search filters', () => {
  const url = new URL(buildSearchUrl({ transaction: 'sale', capRateMin: 0.09, propertyTypes: ['Multifamily'], sort: 'Cap Rate (High to Low)' }));
  assert.equal(url.pathname, '/properties');
  assert.equal(url.searchParams.get('capRateMin'), '9');
  assert.deepEqual(url.searchParams.getAll('types[]'), ['Multifamily']);
  assert.equal(url.searchParams.get('sort'), 'Cap Rate (High to Low)');
  assert.equal(new URL(buildSearchUrl({ transaction: 'lease' })).pathname, '/lease/properties');
});

test('extracts structured result cards and removes known hard failures before detail requests', () => {
  const state = { props: { listings: [
    { url: '/properties/101/good', name: 'Good Apartments', propertyType: 'Multifamily', capRate: '9.35%', unitCount: 33, squareFootage: '35,000 - 45,000 SF', askingPrice: '$3,250,000' },
    { url: '/properties/102/small', name: 'Small Apartments', capRate: '7%', squareFootage: '5,000 SF' }
  ] } };
  const cards = cardSummaries(`<script type="application/json">${JSON.stringify(state)}</script>`);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].sourceListingId, '101');
  assert.equal(cards[0].capRate, 0.0935);
  assert.deepEqual(cards[0].availableSqFt, { min: 35000, max: 45000, basis: 'published' });
  assert.equal(cards[0].unitCount, 33);
  assert.equal(passesHardFilters(cards[0], { capRateMin: 9, area: { minSqFt: 38000, maxSqFt: 38000 } }), true);
  assert.equal(passesHardFilters(cards[1], { capRateMin: 9, area: { minSqFt: 38000, maxSqFt: 38000 } }), false);
});

test('preserves detail labels that are not in the canonical schema as raw fields', async () => {
  const html = '<div>Cap Rate:</div><div>8.75%</div><div>NOI:</div><div>$284,375</div><div>Rent Bumps:</div><div>Yes</div><div>Ground Lease:</div><div>No</div><div>Broker Co-Op:</div><div>Yes</div>';
  const fields = labeledFields(html);
  assert.equal(fields['Rent Bumps'], 'Yes');
  assert.equal(fields['Ground Lease'], 'No');
  const source = new CrexiSource({ delayMs: 0 });
  const property = source.normalize({ url: 'https://www.crexi.com/properties/999/example', capturedAt: '2026-08-27T00:00:00Z', record: {}, rawFields: fields, summary: { transaction: 'sale' } });
  assert.equal(property.capRate, 0.0875);
  assert.equal(property.noi, 284375);
  assert.equal(property.rentBumps, 'Yes');
  assert.equal(property.rawFields['Broker Co-Op'], 'Yes');
});

test('builds a profile and ranks known facts while preserving unknowns', () => {
  const profile = profileFromScan({ document: { location: 'Houston' }, space: { aboaSquareFeet: '38,685', parkingSpaces: '3' }, boundaries: {}, requirements: ['Loading dock'] });
  const result = evaluateProperty(profile, { availableSqFt: { min: 35000, max: 45000 }, evidence: [{ field: 'availableSqFt' }] });
  assert.equal(result.matched, 1);
  assert.equal(result.notMatched, 0);
  assert.equal(result.unknown, 2);
  assert.ok(result.score > 0);
});
