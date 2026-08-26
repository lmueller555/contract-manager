'use strict';

const form = document.querySelector('#upload-form');
const input = document.querySelector('#document');
const dropzone = document.querySelector('#dropzone');
const label = document.querySelector('#file-label');
const progress = document.querySelector('#progress');
const errorBox = document.querySelector('#error');
const button = document.querySelector('#scan-button');
const hero = document.querySelector('.hero');
const dashboard = document.querySelector('#dashboard');
let currentScanId;

function chooseFile(file) {
  if (!file) return;
  label.textContent = file.name;
  dropzone.classList.add('has-file');
}

input.addEventListener('change', () => chooseFile(input.files[0]));
['dragenter', 'dragover'].forEach(event => dropzone.addEventListener(event, e => {
  e.preventDefault(); dropzone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach(event => dropzone.addEventListener(event, e => {
  e.preventDefault(); dropzone.classList.remove('dragging');
}));
dropzone.addEventListener('drop', event => {
  const file = event.dataTransfer.files[0];
  if (file) { const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files; chooseFile(file); }
});

const setText = (id, value, prefix = '') => {
  document.querySelector(`#${id}`).textContent = value && value !== 'Not specified' ? `${prefix}${value}` : 'Not specified';
};

function showDashboard(data) {
  setText('doc-name', data.document.fileName);
  setText('solicitation', `RLP ${data.document.solicitation}${data.document.location !== 'Not specified' ? ` · ${data.document.location}` : ''}`);
  setText('confidence', data.confidence);
  setText('square-feet', data.space.aboaSquareFeet);
  setText('lease-term', data.space.leaseTerm);
  setText('parking', data.space.parkingSpaces);
  setText('due-date', data.document.dueDate);
  ['north', 'south', 'east', 'west'].forEach(key => setText(key, data.boundaries[key]));
  setText('ti', data.space.tenantImprovementAllowance, '$');
  setText('bsac', data.space.securityAllowance, '$');
  setText('statement', data.statement || 'Statement of requirements not identified.');

  const list = document.querySelector('#criteria-list');
  list.replaceChildren(...data.requirements.map(item => {
    const li = document.createElement('li');
    li.innerHTML = '<span>✓</span>';
    li.append(document.createTextNode(item));
    return li;
  }));
  document.querySelector('#criteria-count').textContent = `${data.requirements.length} identified`;
  hero.hidden = true;
  dashboard.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showMatches(matches) {
  const list = document.querySelector('#match-list');
  if (!matches.length) {
    list.innerHTML = '<p class="empty-match">No public listing links were found in the configured search results.</p>';
    return;
  }
  list.replaceChildren(...matches.map(({ property, score, coverage, matched, notMatched, unknown }) => {
    const article = document.createElement('article');
    const heading = document.createElement('h4');
    const link = document.createElement('a');
    link.href = property.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = property.title || property.address || `Crexi listing ${property.sourceListingId}`;
    heading.append(link);
    const facts = document.createElement('p');
    facts.textContent = [property.address, property.availableSqFt?.min ? `${property.availableSqFt.min.toLocaleString()}–${property.availableSqFt.max.toLocaleString()} SF published` : null].filter(Boolean).join(' · ') || 'Listing details require review';
    const badges = document.createElement('div'); badges.className = 'match-badges';
    for (const value of [`${score}% score`, `${coverage}% evidence`, `${matched} matched`, `${notMatched} not matched`, `${unknown} unknown`]) {
      const span = document.createElement('span'); span.textContent = value; badges.append(span);
    }
    article.append(heading, facts, badges); return article;
  }));
}

async function readJson(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(response.ok
      ? 'The server returned an unexpected response.'
      : `The scan service returned an error (HTTP ${response.status}). Please try again.`);
  }
  return response.json();
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForScan(id) {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await wait(1500);
    const response = await fetch(`/api/documents/scan/${encodeURIComponent(id)}`);
    const scan = await readJson(response);
    if (!response.ok) throw new Error(scan.error || 'The document scan could not be retrieved.');
    if (scan.status === 'complete') return scan.result;
    if (scan.status === 'failed') throw new Error(scan.error || 'The document could not be scanned.');
  }
  throw new Error('The document scan is taking longer than expected. Please try again.');
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!input.files[0]) return;
  errorBox.hidden = true; progress.hidden = false; button.disabled = true;
  try {
    const body = new FormData(); body.append('document', input.files[0]);
    const response = await fetch('/api/documents/scan', { method: 'POST', body });
    const scan = await readJson(response);
    if (!response.ok) throw new Error(scan.error || 'The document could not be scanned.');
    if (!scan.id) throw new Error('The scan service returned an invalid response.');
    currentScanId = scan.id;
    showDashboard(await waitForScan(scan.id));
  } catch (error) {
    errorBox.textContent = error.message; errorBox.hidden = false;
  } finally { progress.hidden = true; button.disabled = false; }
});

document.querySelector('#find-matches').addEventListener('click', async () => {
  const button = document.querySelector('#find-matches');
  const progress = document.querySelector('#match-progress');
  const error = document.querySelector('#match-error');
  error.hidden = true; progress.hidden = false; button.disabled = true;
  try {
    const response = await fetch(`/api/documents/scan/${encodeURIComponent(currentScanId)}/crexi-matches`, { method: 'POST' });
    const result = await readJson(response);
    if (!response.ok) throw new Error(result.error || 'Crexi matching could not be completed.');
    showMatches(result.matches);
  } catch (reason) { error.textContent = reason.message; error.hidden = false; }
  finally { progress.hidden = true; button.disabled = false; }
});

document.querySelector('#scan-another').addEventListener('click', () => {
  input.value = ''; label.textContent = 'Drop your lease PDF here'; dropzone.classList.remove('has-file');
  currentScanId = undefined; document.querySelector('#match-list').replaceChildren();
  dashboard.hidden = true; hero.hidden = false; window.scrollTo({ top: 0, behavior: 'smooth' });
});
