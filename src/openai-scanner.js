'use strict';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MODEL = 'gpt-5.1-mini';
const NOT_SPECIFIED = 'Not specified';

const stringField = { type: 'string' };
const requirementsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['document', 'space', 'boundaries', 'requirements', 'statement', 'confidence'],
  properties: {
    document: {
      type: 'object',
      additionalProperties: false,
      required: ['solicitation', 'location', 'dueDate'],
      properties: {
        solicitation: stringField,
        location: stringField,
        dueDate: stringField
      }
    },
    space: {
      type: 'object',
      additionalProperties: false,
      required: ['aboaSquareFeet', 'parkingSpaces', 'leaseTerm', 'tenantImprovementAllowance', 'securityAllowance'],
      properties: {
        aboaSquareFeet: stringField,
        parkingSpaces: stringField,
        leaseTerm: stringField,
        tenantImprovementAllowance: stringField,
        securityAllowance: stringField
      }
    },
    boundaries: {
      type: 'object',
      additionalProperties: false,
      required: ['north', 'south', 'east', 'west'],
      properties: {
        north: stringField,
        south: stringField,
        east: stringField,
        west: stringField
      }
    },
    requirements: {
      type: 'array',
      items: { type: 'string' }
    },
    statement: stringField,
    confidence: { type: 'string', enum: ['High', 'Medium', 'Review needed'] }
  }
};

const instructions = `You are a meticulous commercial real-estate lease analyst. Read the entire attached PDF, including page images, tables, exhibits, amendments, and the statement of requirements. Return a concise requirements dashboard for site qualification.

Rules:
- Use only facts stated in the document. Never infer a missing value.
- For every missing scalar value, return exactly "${NOT_SPECIFIED}".
- Preserve important units, qualifiers, firm terms, dates, street names, and numeric values.
- requirements must be a deduplicated list of all material building, property, access, location, security, loading, elevator, adjacency, transit, amenity, floor/contiguity, and special-use requirements. Each item must be understandable on its own. Do not include generic legal boilerplate.
- statement must be a concise plain-text summary of the requirements, not a transcription. Mention material constraints that do not fit another field.
- confidence is High only when the relevant pages are legible and values are explicit; Medium when the useful extraction is partial; Review needed when the document is unclear, contradictory, or has few identifiable requirements.
- tenantImprovementAllowance and securityAllowance should contain only the numeric amount when one is specified per ABOA SF, because the dashboard supplies the dollar sign and unit.`;

function outputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

async function scanPdf(buffer, metadata = {}, options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 120000);
  let response;

  try {
    response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        instructions,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Analyze this lease solicitation PDF and produce the requirements dashboard.' },
            {
              type: 'input_file',
              filename: metadata.fileName || 'lease.pdf',
              file_data: `data:application/pdf;base64,${buffer.toString('base64')}`
            }
          ]
        }],
        text: {
          format: {
            type: 'json_schema',
            name: 'lease_requirements',
            strict: true,
            schema: requirementsSchema
          }
        },
        max_output_tokens: 6000
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    const error = new Error(details.error?.message || `OpenAI returned HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }

  const apiResponse = await response.json();
  const text = outputText(apiResponse);
  if (!text) throw new Error('OpenAI did not return a requirements summary.');

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error('OpenAI returned an invalid requirements summary.');
  }

  result.document.fileName = metadata.fileName || 'Uploaded document';
  result.document.pages = metadata.pages || null;
  return result;
}

module.exports = { MODEL, requirementsSchema, scanPdf };
