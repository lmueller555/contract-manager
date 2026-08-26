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

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!input.files[0]) return;
  errorBox.hidden = true; progress.hidden = false; button.disabled = true;
  try {
    const body = new FormData(); body.append('document', input.files[0]);
    const response = await fetch('/api/documents/scan', { method: 'POST', body });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The document could not be scanned.');
    showDashboard(result);
  } catch (error) {
    errorBox.textContent = error.message; errorBox.hidden = false;
  } finally { progress.hidden = true; button.disabled = false; }
});

document.querySelector('#scan-another').addEventListener('click', () => {
  input.value = ''; label.textContent = 'Drop your lease PDF here'; dropzone.classList.remove('has-file');
  dashboard.hidden = true; hero.hidden = false; window.scrollTo({ top: 0, behavior: 'smooth' });
});
