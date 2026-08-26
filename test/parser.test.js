'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRequirements, clean } = require('../src/parser');

const fixture = `
GSA REQUEST FOR LEASE PROPOSALS NO. 4TX1037 Rosenberg, TX
Offers due by 09/15/2026
SECTION 1 STATEMENT OF REQUIREMENTS
The Government is seeking 38,685 of American National Standards Institute/Building Owners and Managers Association Office Area square feet.
The Government requires 3 structured/inside or surface/outside parking spaces.
The lease term must be 20 Years, 15 Years Firm, with Government termination rights.
North: I-10 South: Westpark Tollway East: Beltway 8 (Sam Houston Tollway) West: Grand Parkway (99)
1.04 UNIQUE REQUIREMENTS
Space must be contiguous. Offered space must be contiguous on one floor or vertically contiguous on two floors.
Loading bay or dock is required. The Government requires a dedicated freight or comparable elevator.
All visitors shall enter through a single, well-defined, secure entrance that provides protection from the weather.
Buildings that are located within 500 feet of daycare facilities, schools or churches will not be considered.
SECTION 2 ELIGIBILITY AND PREFERENCES FOR AWARD
The TI Allowance is $49.13 per ABOA SF. The BSAC amount is $12.00 per ABOA SF.
`;

test('normalizes typographic punctuation and whitespace', () => {
  assert.equal(clean('  “Lease”  —  test '), '"Lease" - test');
});

test('extracts core solicitation fields and property requirements', () => {
  const result = parseRequirements(fixture, { fileName: 'sample.pdf', pages: 17 });
  assert.equal(result.document.solicitation, '4TX1037');
  assert.equal(result.document.location, 'Rosenberg, TX');
  assert.equal(result.document.pages, 17);
  assert.equal(result.space.aboaSquareFeet, '38,685');
  assert.equal(result.space.parkingSpaces, '3');
  assert.equal(result.boundaries.north, 'I-10');
  assert.equal(result.boundaries.west, 'Grand Parkway (99)');
  assert.ok(result.requirements.includes('Loading bay or dock'));
  assert.ok(result.requirements.includes('Dedicated freight or comparable elevator'));
  assert.equal(result.confidence, 'High');
});

test('returns reviewable defaults when fields are absent', () => {
  const result = parseRequirements('A short unrelated document.');
  assert.equal(result.space.aboaSquareFeet, 'Not specified');
  assert.equal(result.boundaries.north, 'Not specified');
  assert.equal(result.confidence, 'Review needed');
});
