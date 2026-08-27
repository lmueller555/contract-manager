'use strict';

function formatSearchLocation(value) {
  if (!value || /^not specified$/i.test(String(value).trim())) return '';
  return String(value).trim()
    .replace(/^(?:location|market|city)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim()
    .replace(/[.;]+$/, '');
}

module.exports = { formatSearchLocation };
