'use strict';

const { formatSearchLocation } = require('./search-location');

function numberFrom(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value || '').replace(/,/g, '').match(/[\d.]+/);
  return match ? Number(match[0]) : undefined;
}

function profileFromScan(scan) {
  const requestedArea = numberFrom(scan.space?.aboaSquareFeet);
  const parking = numberFrom(scan.space?.parkingSpaces);
  return {
    transaction: 'lease',
    location: formatSearchLocation(scan.document?.location),
    geography: { boundaryText: scan.boundaries || {}, required: true },
    area: requestedArea ? { minSqFt: requestedArea, maxSqFt: requestedArea, basis: 'ABOA' } : {},
    parking: parking ? { minimumSpaces: parking } : {},
    criteria: (scan.requirements || []).map((text, index) => ({
      id: `criterion-${index + 1}`, text, kind: 'qualitative', priority: 'preferred', weight: 1
    }))
  };
}

function evaluateProperty(profile, property) {
  const evaluations = [];
  const add = (id, outcome, explanation, evidenceIndexes = []) => evaluations.push({
    requirementId: id, outcome, confidence: outcome === 'unknown' ? 0 : 1, explanation, evidenceIndexes
  });

  if (profile.area?.minSqFt) {
    const min = property.availableSqFt?.min;
    const max = property.availableSqFt?.max ?? min;
    if (min == null) add('area', 'unknown', 'The listing does not publish available area.');
    else if (max >= profile.area.minSqFt && min <= (profile.area.maxSqFt || profile.area.minSqFt)) {
      add('area', 'matched', 'The published available-area interval overlaps the requested area.', property.evidence.flatMap((e, i) => e.field === 'availableSqFt' ? [i] : []));
    } else add('area', 'not_matched', 'The published available-area interval does not overlap the requested area.');
  }
  if (profile.parking?.minimumSpaces) {
    if (property.parkingSpaces == null) add('parking', 'unknown', 'The listing does not publish a parking-space count.');
    else add('parking', property.parkingSpaces >= profile.parking.minimumSpaces ? 'matched' : 'not_matched',
      `${property.parkingSpaces} published spaces compared with ${profile.parking.minimumSpaces} required.`);
  }
  for (const criterion of profile.criteria || []) add(criterion.id, 'unknown', 'Qualitative requirement requires human review of the source listing.');

  const weights = new Map([['area', 3], ['parking', 3], ...(profile.criteria || []).map(c => [c.id, c.weight || 1])]);
  const totalWeight = [...weights.values()].reduce((sum, weight) => sum + weight, 0) || 1;
  const known = evaluations.filter(e => e.outcome !== 'unknown');
  const knownWeight = known.reduce((sum, e) => sum + (weights.get(e.requirementId) || 1), 0);
  const earnedWeight = known.filter(e => e.outcome === 'matched').reduce((sum, e) => sum + (weights.get(e.requirementId) || 1) * e.confidence, 0);
  const matchScore = knownWeight ? 100 * earnedWeight / knownWeight : 0;
  const coverage = knownWeight / totalWeight;
  return {
    property, evaluations,
    matched: evaluations.filter(e => e.outcome === 'matched').length,
    notMatched: evaluations.filter(e => e.outcome === 'not_matched').length,
    unknown: evaluations.filter(e => e.outcome === 'unknown').length,
    coverage: Math.round(coverage * 100),
    score: Math.round(matchScore * (0.7 + 0.3 * coverage))
  };
}

module.exports = { evaluateProperty, formatSearchLocation, numberFrom, profileFromScan };
