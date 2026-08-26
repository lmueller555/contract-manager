'use strict';

const clean = (value = '') => value
  .replace(/[“”]/g, '"')
  .replace(/[‘’]/g, "'")
  .replace(/[–—]/g, '-')
  .replace(/\s+/g, ' ')
  .trim();

function capture(text, pattern, fallback = 'Not specified') {
  const match = text.match(pattern);
  return match ? clean(match[1]) : fallback;
}

function section(text, start, end) {
  const candidates = [];
  const globalStart = new RegExp(start.source, `${start.flags.replace('g', '')}g`);
  for (const match of text.matchAll(globalStart)) {
    const remainder = text.slice(match.index);
    const to = remainder.slice(1).search(end);
    candidates.push(clean(to < 0 ? remainder : remainder.slice(0, to + 1)));
  }
  return candidates.sort((a, b) => b.length - a.length)[0] || '';
}

function detectList(text, rules) {
  return rules
    .filter(({ pattern }) => pattern.test(text))
    .map(({ label }) => label);
}

function parseRequirements(rawText, metadata = {}) {
  const text = clean(rawText);
  const statement = section(text, /SECTION 1\s+STATEMENT OF REQUIREMENTS/i, /SECTION 2\s+/i);
  const source = statement || text;

  const boundaries = {
    north: capture(source, /North:\s*([^\n]*?)(?=\s+South:)/i),
    south: capture(source, /South:\s*([^\n]*?)(?=\s+East:)/i),
    east: capture(source, /East:\s*([^\n]*?)(?=\s+West:)/i),
    west: capture(source, /West:\s*(.*?)(?=\s+(?:RLP\s+NO\.|Buildings|1\.04|UNIQUE))/i)
  };

  const requirements = detectList(source, [
    { pattern: /space must be contiguous/i, label: 'Contiguous space' },
    { pattern: /one floor or vertically contiguous on two floors/i, label: 'One floor or two vertically contiguous floors' },
    { pattern: /loading bay or dock is required/i, label: 'Loading bay or dock' },
    { pattern: /freight or comparable elevator/i, label: 'Dedicated freight or comparable elevator' },
    { pattern: /secure entrance/i, label: 'Single, secure visitor entrance' },
    { pattern: /protection from the weather/i, label: 'Weather-protected entry queue' },
    { pattern: /public transportation/i, label: 'Walkable public transportation' },
    { pattern: /continuous,? accessible sidewalks/i, label: 'Continuous accessible sidewalks' },
    { pattern: /restaurants|retail shops|cleaners|banks/i, label: 'Nearby employee amenities' },
    { pattern: /500 feet of daycare facilities, schools or churches/i, label: 'At least 500 feet from daycares, schools, and churches' },
    { pattern: /pallet(?:ized)? files|pallet jack/i, label: 'Palletized-file handling route' },
    { pattern: /use of part of the Building roof.*antenna/i, label: 'Roof access for potential antennas' }
  ]);

  const dueDate = capture(text, /Offers due by\s+([A-Za-z0-9/, -]+?)(?=\s+In order|\s+Offers? must|$)/i,
    capture(text, /no later than\s+([A-Za-z]+\s+\d{1,2},\s+\d{4},?\s+\d{1,2}:\d{2}\s*(?:am|pm)?[^.]*Eastern Time)/i));

  return {
    document: {
      fileName: metadata.fileName || 'Uploaded document',
      solicitation: capture(text, /(?:PROPOSALS|RLP)\s+NO\.\s*([A-Z0-9-]+)/i),
      location: capture(text, /(?:PROPOSALS\s+NO\.\s*[A-Z0-9-]+|RLP\s+NO\.\s*[A-Z0-9-]+)[, ]+([A-Za-z ]+,\s*[A-Z]{2})/i),
      dueDate,
      pages: metadata.pages || null
    },
    space: {
      aboaSquareFeet: capture(source, /seeking\s+([\d,]+)\s+(?:of\s+)?American National Standards/i),
      parkingSpaces: capture(source, /requires\s+([\d,]+)\s+(?:structured\/inside or surface\/outside\s+)?parking spaces/i),
      leaseTerm: capture(source, /lease term (?:must|shall) be\s+([^,.]+(?:,\s*[^,.]+)?)/i),
      tenantImprovementAllowance: capture(text, /TI Allowance is\s*\$([\d,.]+)\s+per ABOA SF/i),
      securityAllowance: capture(text, /BSAC\)? amount is\s*\$([\d,.]+)\s+per ABOA SF/i)
    },
    boundaries,
    requirements,
    statement: statement.slice(0, 12000),
    confidence: requirements.length >= 5 ? 'High' : requirements.length >= 2 ? 'Medium' : 'Review needed'
  };
}

module.exports = { parseRequirements, clean };
